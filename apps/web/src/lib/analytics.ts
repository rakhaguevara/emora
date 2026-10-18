import { getDailyBuckets, getHourlyBuckets, type EnergyBucket } from "./live/energy";
import { getHistory } from "./live/history";
import { energyKwhBetween, sampleAt, startOfDay, type World } from "./sim/engine";
import type { Jalur } from "./types";

const DAY = 86400e3;
const HOUR = 3600e3;

export type Bucket = "hour" | "day";

export interface EnergyRow {
  ts: number; // awal jam / awal hari (WIB)
  perJalur: Record<string, number>; // kWh
  total: number;
  // Tegangan panel (sama untuk semua jalur): rata-rata, terendah, tertinggi dalam ember ini
  vAvg: number | null;
  vMin: number | null;
  vMax: number | null;
  pfPerJalur: Record<string, number | null>; // rata-rata saat ada beban
  pMax: number | null; // daya puncak (W), seluruh jalur
  hasData: boolean;
}

/** @deprecated nama lama; sama dengan EnergyRow */
export type DailyRow = EnergyRow;

const emptyRow = (ts: number, jalur: Jalur[]): EnergyRow => ({
  ts,
  perJalur: Object.fromEntries(jalur.map((j) => [j.id, 0])),
  total: 0,
  vAvg: null, vMin: null, vMax: null,
  pfPerJalur: Object.fromEntries(jalur.map((j) => [j.id, null])),
  pMax: null,
  hasData: false,
});

// Awal tiap ember: `days` hari terakhir (hari terakhir = hari ini), atau 24 jam hari ini.
function slots(now: number, days: number, bucket: Bucket): number[] {
  const today = startOfDay(now);
  if (bucket === "hour") return Array.from({ length: 24 }, (_, h) => today + h * HOUR);
  return Array.from({ length: days }, (_, i) => today - (days - 1 - i) * DAY);
}

// Mode live: satu jalur = satu device; ringkasan dihitung Supabase dari data asli.
function liveRows(jalur: Jalur[], now: number, days: number, bucket: Bucket): EnergyRow[] | null {
  const src = bucket === "hour" ? getHourlyBuckets() : getDailyBuckets();
  const j = jalur[0];
  if (!src || !j) return null;
  const byTs = new Map<number, EnergyBucket>(src.map((b) => [b.ts, b]));
  return slots(now, days, bucket).map((ts) => {
    const b = byTs.get(ts);
    if (!b) return emptyRow(ts, jalur);
    return {
      ts,
      perJalur: { [j.id]: b.kwh },
      total: b.kwh,
      vAvg: b.vAvg, vMin: b.vMin, vMax: b.vMax,
      pfPerJalur: { [j.id]: b.pfAvg },
      pMax: b.pMax,
      hasData: b.samples > 0,
    };
  });
}

// Mode demo: dari simulasi, sampel tiap jam (harian) atau tiap 15 menit (per jam).
function simRows(w: World, jalur: Jalur[], now: number, days: number, bucket: Bucket): EnergyRow[] {
  const size = bucket === "hour" ? HOUR : DAY;
  const step = bucket === "hour" ? 15 * 60e3 : HOUR;
  return slots(now, days, bucket).map((from) => {
    if (from > now) return emptyRow(from, jalur);
    const to = Math.min(from + size, now);
    const row = emptyRow(from, jalur);
    const active = jalur.filter((j) => j.createdAt <= to);
    for (const j of active) {
      const kwh = energyKwhBetween(w, j, from, to);
      row.perJalur[j.id] = kwh;
      row.total += kwh;
    }
    let vSum = 0;
    let vN = 0;
    const pf: Record<string, { sum: number; n: number }> = {};
    for (let t = from + step / 2; t < to; t += step) {
      let power = 0;
      for (const j of active) {
        const s = sampleAt(w, j, t);
        if (!s) continue;
        vSum += s.voltage;
        vN++;
        row.vMin = Math.min(row.vMin ?? Infinity, s.voltage);
        row.vMax = Math.max(row.vMax ?? -Infinity, s.voltage);
        power += s.power;
        if (s.pf != null) {
          const a = (pf[j.id] ??= { sum: 0, n: 0 });
          a.sum += s.pf;
          a.n++;
        }
      }
      row.pMax = Math.max(row.pMax ?? 0, power);
    }
    for (const j of active) row.pfPerJalur[j.id] = pf[j.id] ? pf[j.id].sum / pf[j.id].n : null;
    row.vAvg = vN ? vSum / vN : null;
    row.hasData = vN > 0;
    return row;
  });
}

// Energi, tegangan, dan PF per ember. Bawaan: per jam untuk 1 hari, per hari untuk lebih dari 1 hari.
export function energyRows(w: World, jalur: Jalur[], now: number, days: number, bucket: Bucket = days === 1 ? "hour" : "day"): EnergyRow[] {
  const live = jalur.some((j) => getHistory(j.sensorId));
  return (live && liveRows(jalur, now, days, bucket)) || (live ? slots(now, days, bucket).map((ts) => emptyRow(ts, jalur)) : simRows(w, jalur, now, days, bucket));
}

// Energi harian (kWh) per jalur untuk `days` hari terakhir, hari terakhir = hari ini sampai `now`.
export function dailyEnergy(w: World, jalur: Jalur[], now: number, days = 30): EnergyRow[] {
  return energyRows(w, jalur, now, days, "day");
}
