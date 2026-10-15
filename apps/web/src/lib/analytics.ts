import { PF_TARGET, TARIFF_PER_KWH } from "./constants";
import { fmtNum, fmtRp } from "./format";
import { energyKwhBetween, localParts, sampleAt, startOfDay, type World } from "./sim/engine";
import type { Jalur } from "./types";

const DAY = 86400e3;
const HOUR = 3600e3;

export interface DailyRow {
  ts: number; // awal hari (WIB)
  perJalur: Record<string, number>;
  total: number;
}

// Energi harian (kWh) per jalur untuk `days` hari terakhir, hari terakhir = hari ini sampai `now`.
export function dailyEnergy(w: World, jalur: Jalur[], now: number, days = 30): DailyRow[] {
  const today = startOfDay(now);
  const rows: DailyRow[] = [];
  for (let d = days - 1; d >= 0; d--) {
    const from = today - d * DAY;
    const to = Math.min(from + DAY, now);
    const perJalur: Record<string, number> = {};
    let total = 0;
    for (const j of jalur) {
      if (j.createdAt > to) {
        perJalur[j.id] = 0;
        continue;
      }
      const kwh = energyKwhBetween(w, j, from, to);
      perJalur[j.id] = kwh;
      total += kwh;
    }
    rows.push({ ts: from, perJalur, total });
  }
  return rows;
}

// Rata-rata PF harian per jalur (hanya saat relai ON).
export function dailyPf(w: World, jalur: Jalur[], now: number, days = 30): { ts: number; perJalur: Record<string, number | null> }[] {
  const today = startOfDay(now);
  const out = [];
  for (let d = days - 1; d >= 0; d--) {
    const from = today - d * DAY;
    const perJalur: Record<string, number | null> = {};
    for (const j of jalur) {
      let sum = 0;
      let n = 0;
      for (let h = 0; h < 24; h++) {
        const t = from + h * HOUR + HOUR / 2;
        if (t > now) break;
        const s = sampleAt(w, j, t);
        if (s?.pf != null) {
          sum += s.pf;
          n++;
        }
      }
      perJalur[j.id] = n ? sum / n : null;
    }
    out.push({ ts: from, perJalur });
  }
  return out;
}

export interface Recommendation {
  id: string;
  title: string;
  detail: string;
  savingRp: number;
  jalurNumber: number;
  link: { param: "pf" | "power"; range: "7d" };
}

// Temuan efisiensi dihitung dari data 7–30 hari terakhir.
// Estimasi penghematan memakai asumsi sederhana (lihat komentar tiap aturan), bukan tagihan sebenarnya.
export function recommendations(w: World, jalur: Jalur[], now: number): Recommendation[] {
  const out: Recommendation[] = [];
  const week = 7 * DAY;

  for (const j of jalur) {
    // 1) PF di bawah target: jam di bawah target dalam 7 hari.
    let sum = 0;
    let n = 0;
    let below = 0;
    for (let t = now - week; t < now; t += HOUR) {
      const s = sampleAt(w, j, t + HOUR / 2);
      if (s?.pf == null) continue;
      sum += s.pf;
      n++;
      if (s.pf < PF_TARGET) below++;
    }
    if (n > 24) {
      const avg = sum / n;
      if (avg < PF_TARGET) {
        const monthKwh = energyKwhBetween(w, j, now - 30 * DAY, now);
        // Asumsi: biaya kVArh berlebih ≈ 50% dari selisih PF terhadap target, dikalikan biaya energi bulanan.
        out.push({
          id: `pf-${j.id}`,
          title: `Faktor daya Jalur ${j.number} berada di bawah target`,
          detail: `PF rata-rata ${fmtNum(avg, 2)} minggu ini, di bawah target ${fmtNum(PF_TARGET, 2)} selama ${below} jam.`,
          savingRp: monthKwh * TARIFF_PER_KWH * (PF_TARGET - avg) * 0.5,
          jalurNumber: j.number,
          link: { param: "pf", range: "7d" },
        });
      }
    }

    // 2) Pemakaian malam (22:00–05:00) 7 malam terakhir dibanding rata-rata 30 hari.
    const nightKwh = (from: number, to: number) => {
      let wh = 0;
      for (let t = from; t < to; t += 30 * 60e3) {
        const { h } = localParts(t);
        if (h >= 22 || h < 5) {
          const s = sampleAt(w, j, t + 15 * 60e3);
          if (s) wh += (s.power * 0.5);
        }
      }
      return wh / 1000;
    };
    const last7 = nightKwh(now - week, now);
    const avg30Per7 = (nightKwh(now - 30 * DAY, now) / 30) * 7;
    const excess = last7 - avg30Per7;
    if (avg30Per7 > 1 && excess / avg30Per7 > 0.15 && excess > 5) {
      out.push({
        id: `night-${j.id}`,
        title: `Konsumsi malam Jalur ${j.number} tidak biasa`,
        detail: `Pemakaian 22:00–05:00 naik ${fmtNum(excess, 1)} kWh dibanding rata-rata 30 hari.`,
        // Asumsi: kelebihan 7 malam ini berulang tiap minggu selama sebulan (4 minggu).
        savingRp: excess * TARIFF_PER_KWH * 4,
        jalurNumber: j.number,
        link: { param: "power", range: "7d" },
      });
    }
  }
  return out.sort((a, b) => b.savingRp - a.savingRp);
}

export const savingText = (rp: number) => `Potensi hemat ± ${fmtRp(Math.round(rp / 1000) * 1000)}/bulan`;
