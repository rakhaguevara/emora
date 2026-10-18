import { energyKwhLive } from "../live/energy";
import { getHistory, integrateKwh, lowerBound, nearest } from "../live/history";
import type { AppState, Interval, Jalur, Param, Sample } from "../types";

// Data simulasi deterministik: nilai pada waktu t selalu sama untuk jalur yang sama,
// sehingga riwayat 30 hari tidak perlu disimpan. Gangguan (anomali) dan log relai
// disisipkan dari state agar grafik konsisten dengan daftar kejadian.

export type World = Pick<AppState, "seededAt" | "anomalies" | "offLog">;

const WIB = 7 * 3600e3;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export function localParts(t: number) {
  const l = t + WIB;
  return { h: (l % 86400e3) / 3600e3, dow: Math.floor(l / 86400e3 + 4) % 7 }; // dow 0 = Minggu
}
export const startOfDay = (t: number) => Math.floor((t + WIB) / 86400e3) * 86400e3 - WIB;

function hash01(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function noise(seed: number, t: number, periodMs: number): number {
  const x = t / periodMs;
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash01(seed, i) * (1 - u) + hash01(seed, i + 1) * u;
}
const ss = (a: number, b: number, x: number) => {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};
const win = (h: number, a: number, b: number, e = 0.4) => ss(a - e, a + e, h) - ss(b - e, b + e, h);
const nightWin = (h: number, a: number, b: number) => Math.max(win(h, a, 24.6), win(h, -0.6, b));

interface Profile {
  rated: number;
  wobble: number;
  load: (h: number, dow: number, t: number, w: World) => number;
  pf: (load: number) => number;
}

const isWeekend = (dow: number) => dow === 0 || dow === 6;

const PROFILES: Record<number, Profile> = {
  1: { // Kompresor
    rated: 11,
    wobble: 0.12,
    load: (h, dow, t, w) =>
      0.14 + 0.72 * win(h, 6, 22) * (isWeekend(dow) ? 0.55 : 1) +
      (t > w.seededAt - 7 * 86400e3 ? 0.3 * nightWin(h, 22, 5) : 0),
    pf: (l) => 0.92 - 0.05 * (1 - l),
  },
  2: { // Pompa air
    rated: 9,
    wobble: 0.1,
    load: (h, _d, t) => 0.12 + 0.62 * win(h, 5, 20) * (0.8 + 0.4 * noise(22, t, 40 * 60e3)),
    pf: (l) => 0.91 - 0.05 * (1 - l),
  },
  3: { // Penerangan gudang (driver LED, PF rendah)
    rated: 6,
    wobble: 0.05,
    load: (h) => 0.18 + 0.78 * nightWin(h, 17.5, 6),
    pf: (l) => 0.72 + 0.14 * l,
  },
  4: { // Mesin bubut
    rated: 12,
    wobble: 0.18,
    load: (h, dow) =>
      0.05 + 0.8 * win(h, 7.5, 16.5) * (isWeekend(dow) ? 0.05 : 1) * (1 - 0.5 * win(h, 12, 13)),
    pf: (l) => 0.9 - 0.06 * (1 - l),
  },
  5: { // HVAC kantor
    rated: 7,
    wobble: 0.08,
    load: (h, dow) =>
      isWeekend(dow) ? 0.15 + 0.35 * win(h, 8, 17) : 0.2 + 0.7 * win(h, 7, 18),
    pf: (l) => 0.93 - 0.05 * (1 - l),
  },
};
const GENERIC: Profile = {
  rated: 8,
  wobble: 0.1,
  load: (h) => 0.2 + 0.5 * win(h, 7, 19),
  pf: (l) => 0.9 - 0.06 * (1 - l),
};
const profileFor = (n: number) => PROFILES[n] ?? GENERIC;

export function isOff(intervals: Interval[] | undefined, t: number): boolean {
  return !!intervals?.some((i) => t >= i.from && (i.to == null || t < i.to));
}

const r = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

export function sampleAt(w: World, j: Jalur, t: number, withEnergy = false): Sample | null {
  const hist = getHistory(j.sensorId);
  if (hist) {
    const s = nearest(hist, t);
    if (!s) return null;
    return { ...s, energyKwh: withEnergy ? integrateKwh(hist, startOfDay(t), t) : 0 };
  }
  if (j.offlineSince != null && t >= j.offlineSince) return null;
  const seed = j.number * 7919;
  const p = profileFor(j.number);
  const { h, dow } = localParts(t);

  let load = p.load(h, dow, t, w);
  load = load * (1 + p.wobble * (noise(seed + 1, t, 900e3) - 0.5) * 2) + 0.015 * (noise(seed + 2, t, 30e3) - 0.5);
  load = clamp(load, 0, 1.2);
  let current = p.rated * load;
  let pf = p.pf(clamp(load, 0, 1)) + 0.02 * (noise(seed + 3, t, 120e3) - 0.5);

  for (const a of w.anomalies) {
    if (a.jalurId !== j.id || t < a.start || t > a.end) continue;
    const x = (t - a.start) / (a.end - a.start);
    const weight =
      a.shape === "ramp"
        ? Math.pow(x, 300)
        : a.shape === "surge"
          ? Math.min(ss(0, 4000, t - a.start), 1 - ss(0, 6000, t - (a.end - 6000)))
          : Math.min(1, Math.sin(Math.PI * x) * 4);
    if (a.param === "current") current += (a.peak - current) * weight;
    else pf += (a.peak - pf) * weight;
  }

  const voltage =
    224 + 9 * (noise(seed + 4, t, 90e3) - 0.5) - 1.5 * load + 0.8 * (noise(seed + 5, t, 2e3) - 0.5);
  const frequency = 50 + 0.4 * (noise(seed + 6, t, 45e3) - 0.5);

  const off = isOff(w.offLog[j.id], t);
  pf = clamp(pf, 0.5, 0.99);
  const s: Sample = {
    ts: t,
    voltage: r(voltage, 1),
    current: off ? 0 : r(current, 2),
    power: off ? 0 : Math.round(voltage * current * pf),
    pf: off ? null : r(pf, 2),
    frequency: r(frequency, 2),
    energyKwh: 0,
  };
  if (withEnergy) s.energyKwh = r(energyKwhBetween(w, j, startOfDay(t), t), 1);
  return s;
}

export function energyKwhBetween(w: World, j: Jalur, from: number, to: number): number {
  const hist = getHistory(j.sensorId);
  // Data asli: counter energi PZEM dari ringkasan Supabase; integrasi daya 24 jam hanya cadangan sebelum termuat.
  if (hist) return energyKwhLive(from, to) ?? integrateKwh(hist, from, to);
  const step = 15 * 60e3;
  let wh = 0;
  for (let t0 = from; t0 < to; t0 += step) {
    const t1 = Math.min(t0 + step, to);
    const s = sampleAt(w, j, (t0 + t1) / 2);
    if (s) wh += (s.power * (t1 - t0)) / 3600e3;
  }
  return wh / 1000;
}

export interface Point {
  ts: number;
  value: number | null;
}

// Deret waktu untuk grafik. Langkah >= 1 jam dirata-ratakan dari beberapa sub-sampel.
export function series(w: World, j: Jalur, param: Param, from: number, to: number, stepMs: number): Point[] {
  const hist = getHistory(j.sensorId);
  if (hist) {
    // Data asli: rata-rata semua sampel di sekitar titik; bila kosong, pakai sampel terdekat.
    const out: Point[] = [];
    for (let ts = from; ts <= to; ts += stepMs) {
      let sum = 0;
      let n = 0;
      for (let i = lowerBound(hist, ts - stepMs / 2); i < hist.length && hist[i].ts < ts + stepMs / 2; i++) {
        const v = hist[i][param];
        if (v != null) {
          sum += v;
          n++;
        }
      }
      out.push({ ts, value: n ? sum / n : (nearest(hist, ts)?.[param] ?? null) });
    }
    return out;
  }
  const subs = stepMs >= 3600e3 ? 4 : 1;
  const out: Point[] = [];
  for (let ts = from; ts <= to; ts += stepMs) {
    let sum = 0;
    let n = 0;
    for (let k = 0; k < subs; k++) {
      const s = sampleAt(w, j, ts + (k * stepMs) / subs);
      const v = s ? s[param] : null;
      if (v != null) {
        sum += v;
        n++;
      }
    }
    out.push({ ts, value: n ? sum / n : null });
  }
  return out;
}

// Min/maks 24 jam terakhir, hanya dari saat relai ON untuk arus/daya/PF.
export function rangeStats(
  w: World,
  j: Jalur,
  param: Param,
  now: number,
  extra?: Sample | null,
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  const hist = getHistory(j.sensorId);
  if (hist) {
    for (let i = lowerBound(hist, now - 24 * 3600e3); i < hist.length && hist[i].ts <= now; i++) {
      const v = hist[i][param];
      if (v == null) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return Number.isFinite(min) ? { min, max } : null;
  }
  if (extra && extra.ts >= now - 24 * 3600e3 && extra[param] != null) {
    min = max = extra[param] as number;
  }
  for (let t = now - 24 * 3600e3; t <= now; t += 5 * 60e3) {
    const s = sampleAt(w, j, t);
    if (!s) continue;
    if (s.pf === null && param !== "voltage" && param !== "frequency") continue;
    const v = s[param];
    if (v == null) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Number.isFinite(min) ? { min, max } : null;
}
