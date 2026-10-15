import { fmtDay, fmtHM } from "./format";

export type RangeKey = "1h" | "24h" | "7d" | "30d";

export const RANGE_META: Record<RangeKey, { label: string; spanMs: number; stepMs: number; tickMs: number; caption: string }> = {
  "1h": { label: "1 j", spanMs: 3600e3, stepMs: 60e3, tickMs: 10 * 60e3, caption: "Data per menit" },
  "24h": { label: "24 j", spanMs: 24 * 3600e3, stepMs: 60e3, tickMs: 4 * 3600e3, caption: "Data per menit" },
  "7d": { label: "7 h", spanMs: 7 * 86400e3, stepMs: 3600e3, tickMs: 86400e3, caption: "Rata-rata per jam" },
  "30d": { label: "30 h", spanMs: 30 * 86400e3, stepMs: 3600e3, tickMs: 5 * 86400e3, caption: "Rata-rata per jam" },
};

const WIB = 7 * 3600e3;

// Tick sejajar batas waktu lokal (WIB), bukan batas UTC.
export function timeTicks(from: number, to: number, tickMs: number): number[] {
  const first = Math.ceil((from + WIB) / tickMs) * tickMs - WIB;
  const out: number[] = [];
  for (let t = first; t <= to; t += tickMs) out.push(t);
  return out;
}

export function formatTick(ts: number, key: RangeKey): string {
  return key === "1h" || key === "24h" ? fmtHM(ts) : fmtDay(ts);
}

export function niceStep(range: number, count = 4): number {
  const raw = range / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

export function niceDomain(lo: number, hi: number, count = 4): { domain: [number, number]; ticks: number[] } {
  const step = niceStep(hi - lo || 1, count);
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = a; v <= b + step / 2; v += step) ticks.push(+v.toFixed(6));
  return { domain: [a, b], ticks };
}
