import { evaluate, type AlertType } from './alerts.js';
import { supabase } from './supabase.js';
import { thresholdsSchema, type Telemetry, type Thresholds } from './schema.js';

const THRESHOLD_TTL_MS = 60_000;
const thresholdCache = new Map<string, { th: Thresholds; at: number }>();
// device_id -> tipe alert yang sedang terbuka (agar alert tidak diinsert tiap detik)
const openAlerts = new Map<string, Set<AlertType>>();

async function getThresholds(deviceId: string): Promise<Thresholds | null> {
  const hit = thresholdCache.get(deviceId);
  if (hit && Date.now() - hit.at < THRESHOLD_TTL_MS) return hit.th;

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

export class UnknownDeviceError extends Error {}

export async function ingest(t: Telemetry): Promise<void> {
  const th = await getThresholds(t.device_id);
  if (!th) throw new UnknownDeviceError(`Device ${t.device_id} belum terdaftar di tabel devices`);

  const { error } = await supabase.from('readings').insert(t);
  if (error) throw error;
  await supabase.from('devices').update({ last_seen: new Date().toISOString() }).eq('id', t.device_id);

  const violations = evaluate(t, th);
  const open = await getOpenAlerts(t.device_id);
  const activeTypes = new Set(violations.map((v) => v.type));

  for (const v of violations) {
    if (open.has(v.type)) continue;
    const { error: e } = await supabase.from('alerts').insert({ device_id: t.device_id, ...v });
    if (e) throw e;
    open.add(v.type);
  }
  for (const type of [...open]) {
    if (activeTypes.has(type)) continue;
    const { error: e } = await supabase
      .from('alerts')
      .update({ resolved_at: new Date().toISOString() })
      .eq('device_id', t.device_id).eq('type', type).is('resolved_at', null);
    if (e) throw e;
    open.delete(type);
  }
}
