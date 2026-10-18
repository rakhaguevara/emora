import type { FastifyBaseLogger } from 'fastify';
import { evaluate, type AlertType, type Violation } from './alerts.js';
import { onAllClear, onLocalTrip, onViolationsOpened } from './automation.js';
import { supabase } from './supabase.js';
import { thresholdsSchema, type Telemetry, type Thresholds } from './schema.js';

const THRESHOLD_TTL_MS = 60_000;
const thresholdCache = new Map<string, { th: Thresholds; at: number }>();
// device_id -> tipe alert yang sedang terbuka (agar alert tidak diinsert tiap detik)
const openAlerts = new Map<string, Set<AlertType>>();

async function getThresholds(deviceId: string): Promise<Thresholds | null> {
  const hit = thresholdCache.get(deviceId);
  if (hit) {
    // Cache basi tetap dipakai (diperbarui di belakang) agar balasan ke ESP32 tidak menunggu Supabase.
    if (Date.now() - hit.at >= THRESHOLD_TTL_MS) {
      hit.at = Date.now();
      fetchThresholds(deviceId).catch(() => { hit.at = 0; });
    }
    return hit.th;
  }
  return fetchThresholds(deviceId);
}

// Dipanggil setelah admin mengubah ambang, agar pembacaan berikutnya langsung memakai nilai baru.
export function invalidateThresholds(deviceId: string) {
  thresholdCache.delete(deviceId);
}

async function fetchThresholds(deviceId: string): Promise<Thresholds | null> {
  const { data, error } = await supabase.from('devices').select('thresholds').eq('id', deviceId).maybeSingle();
  if (error) throw error;
  if (!data) return null; // device belum terdaftar
  const th = thresholdsSchema.parse(data.thresholds);
  thresholdCache.set(deviceId, { th, at: Date.now() });
  return th;
}

async function getOpenAlerts(deviceId: string): Promise<Set<AlertType>> {
  let set = openAlerts.get(deviceId);
  if (set) return set;
  const { data, error } = await supabase
    .from('alerts').select('type').eq('device_id', deviceId).is('resolved_at', null);
  if (error) throw error;
  set = new Set((data ?? []).map((r) => r.type as AlertType));
  openAlerts.set(deviceId, set);
  return set;
}

let log: FastifyBaseLogger | Console = console;
export function setIngestLogger(l: FastifyBaseLogger) {
  log = l;
}

export class UnknownDeviceError extends Error {}

// Kolom telemetri yang menentukan tiap jenis alert
const ALERT_INPUT: Record<AlertType, 'voltage' | 'current' | 'power' | 'temperature' | 'frequency' | 'pf' | 'hourly_energy_wh'> = {
  undervoltage: 'voltage',
  overvoltage: 'voltage',
  overcurrent: 'current',
  overpower: 'power',
  overheat: 'temperature',
  frequency: 'frequency',
  power_factor: 'pf',
  energy_hourly: 'hourly_energy_wh',
};

// Rentang ukur PZEM-004T v3 (dengan sedikit kelonggaran). Di luar ini = pembacaan rusak, mis. saat relai
// berpindah atau listrik terputus (pernah tercatat daya 215 juta W dan frekuensi 300 Hz).
const PLAUSIBLE: Partial<Record<keyof Telemetry, [number, number]>> = {
  voltage: [0, 300],
  current: [0, 110],
  power: [0, 25_000],
  frequency: [40, 70],
  pf: [0, 1],
  energy_wh: [0, 10_000_000], // counter PZEM maks. 9.999,99 kWh
};
const ELECTRICAL = ['voltage', 'current', 'power', 'energy_wh', 'frequency', 'pf', 'hourly_energy_wh'] as const;

// Satu nilai listrik mustahil = seluruh bingkai PZEM tidak bisa dipercaya: semua nilai listrik dijadikan null
// (diperlakukan seperti sensor gagal dibaca, jadi tidak memicu anomali atau pemutusan relai).
function sanitize(t: Telemetry): Telemetry {
  const bad = Object.entries(PLAUSIBLE).find(([k, [lo, hi]]) => {
    const v = t[k as keyof Telemetry];
    return typeof v === 'number' && (v < lo || v > hi);
  });
  if (!bad) return t;
  log.warn({ deviceId: t.device_id, field: bad[0], value: t[bad[0] as keyof Telemetry] }, 'Pembacaan PZEM tidak masuk akal, dianggap sensor gagal');
  const out = { ...t };
  for (const k of ELECTRICAL) out[k] = null;
  return out;
}

// Penyimpanan diantrekan berurutan supaya status alert tidak balapan antar pembacaan.
let queue: Promise<void> = Promise.resolve();

// Memvalidasi device lalu langsung kembali; penyimpanan ke Supabase berjalan di belakang.
// Dengan begitu ESP32 tidak timeout saat koneksi laptop ke Supabase lambat.
export async function ingest(t: Telemetry, onError: (err: unknown) => void): Promise<void> {
  const th = await getThresholds(t.device_id);
  if (!th) throw new UnknownDeviceError(`Device ${t.device_id} belum terdaftar di tabel devices`);
  const clean = sanitize(t);
  queue = queue.then(() => persist(clean, th)).catch(onError);
}

async function persist(full: Telemetry, th: Thresholds): Promise<void> {
  // Kolom proteksi lokal bukan bagian tabel readings
  const { local_trip_at: tripAt, local_trip_reason: tripReason, ...t } = full;
  const { error } = await supabase.from('readings').insert(t);
  if (error) throw error;
  await supabase.from('devices').update({ last_seen: new Date().toISOString() }).eq('id', t.device_id);

  const violations = evaluate(t, th);
  const open = await getOpenAlerts(t.device_id);
  const activeTypes = new Set(violations.map((v) => v.type));

  const opened: Violation[] = [];
  for (const v of violations) {
    if (open.has(v.type)) continue;
    const { error: e } = await supabase.from('alerts').insert({ device_id: t.device_id, ...v });
    if (e) throw e;
    open.add(v.type);
    opened.push(v);
  }
  for (const type of [...open]) {
    // Nilai null = sensor gagal dibaca (mis. PZEM tidak menjawab): kondisinya tidak diketahui, alert jangan ditutup.
    if (activeTypes.has(type) || t[ALERT_INPUT[type]] == null) continue;
    const { error: e } = await supabase
      .from('alerts')
      .update({ resolved_at: new Date().toISOString() })
      .eq('device_id', t.device_id).eq('type', type).is('resolved_at', null);
    if (e) throw e;
    open.delete(type);
  }

  // Respons relai terhadap anomali (lihat automation.ts)
  if (tripAt) await onLocalTrip(t.device_id, tripAt, tripReason || 'Proteksi lokal ESP32', log as FastifyBaseLogger);
  if (opened.length) await onViolationsOpened(t.device_id, opened, t.relay_on !== false, log as FastifyBaseLogger);
  else if (!violations.length && t.voltage != null) await onAllClear(t.device_id);
}
