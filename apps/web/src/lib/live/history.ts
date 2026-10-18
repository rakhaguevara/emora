import type { Sample } from "../types";

// Riwayat pembacaan asli dari Supabase, per device_id, urut waktu naik.
// Dipakai sim/engine.ts sebagai pengganti data simulasi untuk jalur yang sensorId-nya terdaftar di sini.

export interface LiveSample extends Sample {
  temperature: number | null;
  humidity: number | null;
  relayOn: boolean | null;
}

export const KEEP_MS = 24 * 3600e3;
// ESP32 mengirim tiap 5 detik. Sampel terdekat lebih jauh dari ini dianggap "tidak ada data".
export const MAX_GAP_MS = 15_000;

const store = new Map<string, LiveSample[]>();

export const getHistory = (deviceId: string): LiveSample[] | undefined => store.get(deviceId);

export function appendHistory(deviceId: string, rows: LiveSample[], now: number) {
  const arr = store.get(deviceId) ?? [];
  const last = arr.length ? arr[arr.length - 1].ts : -Infinity;
  for (const r of rows) if (r.ts > last) arr.push(r);
  const cut = lowerBound(arr, now - KEEP_MS);
  if (cut > 0) arr.splice(0, cut);
  store.set(deviceId, arr);
}

// Indeks pertama dengan ts >= t
export function lowerBound(arr: LiveSample[], t: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].ts < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function nearest(arr: LiveSample[], t: number): LiveSample | null {
  const i = lowerBound(arr, t);
  let best: LiveSample | null = null;
  for (const k of [i - 1, i]) {
    const s = arr[k];
    if (s && (!best || Math.abs(s.ts - t) < Math.abs(best.ts - t))) best = s;
  }
  return best && Math.abs(best.ts - t) <= MAX_GAP_MS ? best : null;
}

// Energi (kWh) dari integrasi daya antar sampel berurutan. Celah lebih dari 2x MAX_GAP_MS dilewati.
export function integrateKwh(arr: LiveSample[], from: number, to: number): number {
  let wh = 0;
  for (let i = Math.max(1, lowerBound(arr, from)); i < arr.length && arr[i].ts <= to; i++) {
    const a = arr[i - 1];
    const b = arr[i];
    const dt = b.ts - a.ts;
    if (a.ts < from || dt > 2 * MAX_GAP_MS) continue;
    wh += ((a.power + b.power) / 2) * (dt / 3600e3);
  }
  return wh / 1000;
}
