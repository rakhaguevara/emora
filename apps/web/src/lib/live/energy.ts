// Ringkasan energi dari Supabase (fungsi energy_buckets) dan rekomendasi harian dari admin (tabel daily_tips).
// Energi dihitung dari counter kumulatif PZEM, jadi riwayat 30 hari tersedia walau browser baru dibuka
// dan energi selama ESP32 offline tetap terhitung. Diperbarui tiap menit oleh live/sync.ts.

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const WIB = 7 * HOUR;
const dayStart = (t: number) => Math.floor((t + WIB) / DAY) * DAY - WIB;

// Jumlah hari yang diambil: 30 hari + 30 hari sebelumnya (pembanding) + hari ini
export const DAILY_DAYS = 61;
const HOURLY_HOURS = 49;

export interface EnergyBucket {
  ts: number; // awal jam / awal hari (WIB)
  kwh: number;
  vAvg: number | null;
  vMin: number | null;
  vMax: number | null;
  pfAvg: number | null; // hanya saat ada beban (>= 1 W)
  pAvg: number | null;
  pMax: number | null;
  iMax: number | null;
  samples: number;
}

export interface DailyTip {
  id: number;
  day: string; // YYYY-MM-DD (WIB)
  title: string;
  body: string;
  savingKwhPerDay: number | null;
  createdBy: string;
  updatedAt: number;
}

interface BucketRow {
  bucket: string;
  energy_wh: number;
  v_avg: number | null;
  v_min: number | null;
  v_max: number | null;
  pf_avg: number | null;
  p_avg: number | null;
  p_max: number | null;
  i_max: number | null;
  samples: number;
}

interface TipRow {
  id: number;
  day: string;
  title: string;
  body: string;
  saving_kwh_per_day: number | null;
  created_by: string;
  updated_at: string;
}

interface Series {
  from: number;
  syncedAt: number; // ember terakhir hanya berisi data sampai waktu ini
  rows: EnergyBucket[];
}
let daily: Series | null = null;
let hourly: Series | null = null;
let tips: DailyTip[] = [];

async function rpcBuckets(deviceId: string, from: number, to: number, bucket: "day" | "hour"): Promise<EnergyBucket[]> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/energy_buckets`, {
    method: "POST",
    headers: { apikey: SB_KEY!, "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      p_device: deviceId, p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString(), p_bucket: bucket,
    }),
  });
  if (res.status === 404) {
    throw new Error(`fungsi energy_buckets belum ada. ${MIGRATION_HINT}`);
  }
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  const rows = (await res.json()) as BucketRow[];
  return rows.map((r) => ({
    ts: Date.parse(r.bucket),
    kwh: r.energy_wh / 1000,
    vAvg: r.v_avg, vMin: r.v_min, vMax: r.v_max,
    pfAvg: r.pf_avg, pAvg: r.p_avg, pMax: r.p_max, iMax: r.i_max,
    samples: Number(r.samples),
  }));
}

export async function syncEnergy(deviceId: string, now = Date.now()) {
  const dFrom = dayStart(now) - (DAILY_DAYS - 1) * DAY;
  const hFrom = Math.floor((now - HOURLY_HOURS * HOUR) / HOUR) * HOUR;
  const to = now + 60e3;
  const [d, h] = await Promise.all([
    rpcBuckets(deviceId, dFrom, to, "day"),
    rpcBuckets(deviceId, hFrom, to, "hour"),
  ]);
  daily = { from: dFrom, syncedAt: now, rows: d };
  hourly = { from: hFrom, syncedAt: now, rows: h };
}

const MIGRATION_HINT = "Jalankan supabase/migrations/20261018010000_energy_admin.sql di SQL Editor Supabase";

export async function fetchTips(deviceId: string): Promise<DailyTip[]> {
  const res = await fetch(
    `${SB_URL}/rest/v1/daily_tips?select=id,day,title,body,saving_kwh_per_day,created_by,updated_at` +
      `&device_id=eq.${encodeURIComponent(deviceId)}&order=day.desc,id.asc&limit=200`,
    { headers: { apikey: SB_KEY! }, cache: "no-store" },
  );
  if (res.status === 404) throw new Error(`tabel daily_tips belum ada. ${MIGRATION_HINT}`);
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return ((await res.json()) as TipRow[]).map((r) => ({
    id: r.id, day: r.day, title: r.title, body: r.body, savingKwhPerDay: r.saving_kwh_per_day,
    createdBy: r.created_by, updatedAt: Date.parse(r.updated_at),
  }));
}

export async function syncTips(deviceId: string) {
  tips = await fetchTips(deviceId);
}

export interface DeviceTariff {
  id: string;
  name: string;
  tariff_class: string;
  tariff_per_kwh: number;
  tax_percent: number;
}

// Daftar perangkat beserta tarifnya (halaman Admin)
export async function fetchDeviceTariffs(): Promise<DeviceTariff[]> {
  const res = await fetch(`${SB_URL}/rest/v1/devices?select=id,name,tariff_class,tariff_per_kwh,tax_percent&order=id.asc`, {
    headers: { apikey: SB_KEY! }, cache: "no-store",
  });
  if (res.status === 400) throw new Error(`kolom tarif belum ada. ${MIGRATION_HINT}`);
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json() as Promise<DeviceTariff[]>;
}

export const energyLoaded = () => daily != null;
export const getDailyBuckets = (): EnergyBucket[] | null => daily?.rows ?? null;
export const getHourlyBuckets = (): EnergyBucket[] | null => hourly?.rows ?? null;
export const getTips = (): DailyTip[] => tips;

// Energi (kWh) antara from..to dari ringkasan per jam (bila tercakup) atau per hari.
// Ember yang terpotong dihitung proporsional terhadap bagian yang sudah berisi data
// (ember berjalan, mis. jam ini, baru terisi sampai waktu sinkron). null = ringkasan belum termuat.
export function energyKwhLive(from: number, to: number): number | null {
  const src = hourly && from >= hourly.from ? { s: hourly, size: HOUR } : daily && from >= daily.from ? { s: daily, size: DAY } : null;
  if (!src) return null;
  let kwh = 0;
  for (const b of src.s.rows) {
    const end = Math.min(b.ts + src.size, src.s.syncedAt);
    if (end <= from || b.ts >= to || end <= b.ts) continue;
    const overlap = Math.min(end, to) - Math.max(b.ts, from);
    kwh += b.kwh * Math.min(1, overlap / (end - b.ts));
  }
  return kwh;
}
