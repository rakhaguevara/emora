import { dailyEnergy } from "./analytics";
import { energyKwhBetween, series, startOfDay } from "./sim/engine";
import { ymd } from "./format";
import type { AppState } from "./types";

const DAY = 86400e3;

export interface Overview {
  total: { ts: number; w: number }[]; // daya total tiap 5 menit, 24 jam terakhir
  peak: { w: number; ts: number } | null; // puncak sejak 00:00
  avg1h: number | null;
  todayKwh: number;
  yesterdayKwh: number; // energi kemarin pada jam yang sama
  monthProjectionKwh: number;
}

// Perhitungan berat (ratusan sampel). Dipanggil per menit, bukan per detik.
export function computeOverview(app: AppState, now: number): Overview {
  const from = now - DAY;
  const per = app.jalur.map((j) => series(app, j, "power", from, now, 5 * 60e3));
  const total = (per[0] ?? []).map((p, i) => ({
    ts: p.ts,
    w: per.reduce((s, arr) => s + (arr[i]?.value ?? 0), 0),
  }));

  const today0 = startOfDay(now);
  let peak: Overview["peak"] = null;
  for (const p of total) if (p.ts >= today0 && (!peak || p.w > peak.w)) peak = { w: p.w, ts: p.ts };
  const lastHour = total.filter((p) => p.ts > now - 3600e3);
  const avg1h = lastHour.length ? lastHour.reduce((s, p) => s + p.w, 0) / lastHour.length : null;

  const elapsed = now - today0;
  let todayKwh = 0;
  let yesterdayKwh = 0;
  for (const j of app.jalur) {
    todayKwh += energyKwhBetween(app, j, today0, now);
    yesterdayKwh += energyKwhBetween(app, j, today0 - DAY, today0 - DAY + elapsed);
  }

  // Proyeksi bulan ini = hari lengkap bulan ini + hari ini (minimal rata-rata 7 hari) + sisa hari x rata-rata 7 hari.
  const rows = dailyEnergy(app, app.jalur, now, 31);
  const complete = rows.slice(0, -1);
  const last7 = complete.slice(-7);
  const avg7 = last7.length ? last7.reduce((s, r) => s + r.total, 0) / last7.length : 0;
  const [y, m, d] = ymd(now).split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthKey = ymd(now).slice(0, 7);
  const mtd = complete.filter((r) => ymd(r.ts).slice(0, 7) === monthKey).reduce((s, r) => s + r.total, 0);
  const monthProjectionKwh = mtd + Math.max(rows[rows.length - 1]?.total ?? 0, avg7) + avg7 * (daysInMonth - d);

  return { total, peak, avg1h, todayKwh, yesterdayKwh, monthProjectionKwh };
}
