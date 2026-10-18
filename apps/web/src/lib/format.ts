const TZ = "Asia/Jakarta";

export function fmtNum(n: number, digits = 1): string {
  return n.toLocaleString("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Desimal adaptif: beban kecil (lampu, charger) tetap terbaca, nilai besar tetap ringkas.
// base = jumlah desimal minimum untuk nilai >= 10.
export function smartDigits(n: number, base: number): number {
  const a = Math.abs(n);
  if (a === 0 || !Number.isFinite(a)) return base;
  if (a < 0.1) return Math.max(base, 3);
  if (a < 1) return Math.max(base, 2);
  if (a < 10) return Math.max(base, 1);
  return base;
}

export const fmtSmart = (n: number, base = 0) => fmtNum(n, smartDigits(n, base));

// Energi di bawah 1 kWh ditampilkan dalam Wh agar tidak terbaca 0,0 kWh.
export function fmtEnergy(kwh: number): { value: string; unit: "Wh" | "kWh" } {
  if (Math.abs(kwh) < 1) return { value: fmtSmart(kwh * 1000, 0), unit: "Wh" };
  return { value: fmtNum(kwh, kwh < 10 ? 2 : 1), unit: "kWh" };
}

export const fmtEnergyText = (kwh: number) => {
  const e = fmtEnergy(kwh);
  return `${e.value} ${e.unit}`;
};

// Desimal label sumbu dari jarak antar tick (0,01 -> 2 desimal)
export function tickDigits(ticks: number[]): number {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  return step > 0 && step < 1 ? Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)) : 0;
}

export function fmtRp(n: number): string {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

// "Rp 5,6 jt" / "Rp 450 rb" untuk angka besar di kartu ringkas
export function fmtRpShort(n: number): string {
  if (n >= 1e9) return `Rp ${fmtNum(n / 1e9, 1)} M`;
  if (n >= 1e6) return `Rp ${fmtNum(n / 1e6, 1)} jt`;
  if (n >= 1e3) return `Rp ${fmtNum(n / 1e3, 0)} rb`;
  return fmtRp(n);
}

const timeFmt = new Intl.DateTimeFormat("id-ID", {
  timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
const hmFmt = new Intl.DateTimeFormat("id-ID", {
  timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const dayFmt = new Intl.DateTimeFormat("id-ID", { timeZone: TZ, day: "numeric", month: "short" });
const dayLongFmt = new Intl.DateTimeFormat("id-ID", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

// "14.32.08" (id-ID memakai titik) -> "14:32:08"
export const fmtTime = (ts: number) => timeFmt.format(ts).replace(/\./g, ":");
export const fmtHM = (ts: number) => hmFmt.format(ts).replace(/\./g, ":");
export const fmtDay = (ts: number) => dayFmt.format(ts);
export const fmtDayLong = (ts: number) => dayLongFmt.format(ts);
export const fmtDateTimeLong = (ts: number) => `${dayLongFmt.format(ts)}, ${fmtHM(ts)}`;
export const ymd = (ts: number) => ymdFmt.format(ts);

export function dayDiff(a: number, b: number): number {
  const da = Date.parse(ymd(a) + "T00:00:00Z");
  const db = Date.parse(ymd(b) + "T00:00:00Z");
  return Math.round((da - db) / 86400000);
}

export function fmtEventTime(ts: number, now: number): string {
  const d = dayDiff(now, ts);
  if (d === 0) return fmtTime(ts);
  if (d === 1) return `Kemarin, ${fmtHM(ts)}`;
  return `${fmtDay(ts)}, ${fmtHM(ts)}`;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} dtk`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} j ${m % 60} mnt` : `${h} j`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} h ${h % 24} j` : `${d} h`;
}

export function fmtAgo(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} dtk lalu`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} j lalu`;
  return `${Math.floor(h / 24)} h lalu`;
}

export function fmtUptime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(h / 24);
  return `${d} hari ${h % 24} jam`;
}

// Parse angka dari input pengguna: "3.500", "3500", "15,5", "15.5"
export function parseLocaleNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  let norm = s;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) norm = s.replace(/\./g, "").replace(",", ".");
  else norm = s.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(norm)) return null;
  return Number(norm);
}
