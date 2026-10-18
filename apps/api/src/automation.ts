import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NO_TRIP, type AlertType, type Violation } from './alerts.js';
import { actorOf, requirePin, requireUser } from './auth/guard.js';
import {
  createRelayCommand, desiredRelay, ESP32_LOCAL, setRelayPolicy, SYSTEM, type Actor, type Mode,
} from './relay.js';
import { supabase } from './supabase.js';

// Respons terhadap anomali (nilai di luar ambang batas di tabel devices):
// 1. Saat alert baru terbuka dan relai menyala, dibuat rekomendasi 'relay_off' (tabel recommendations).
//    Suhu (overheat) tidak memicu rekomendasi: hanya alert peringatan.
// 2. Dashboard menampilkan pop-up dengan hitung mundur sesuai mode device:
//    - 'auto'      : relai diputus otomatis setelah AUTO_CUT_SEC kecuali dibatalkan.
//    - 'semi_auto' : pengguna memutuskan dalam DECISION_SEC; bila tidak ada keputusan, pengaman memutus relai.
// 3. Operator bisa "Putus sekarang" (execute) atau "Biarkan menyala" (dismiss); keduanya wajib PIN operator.
// 4. Bila semua nilai kembali normal sebelum waktu habis, rekomendasi kedaluwarsa (expired).
// 5. Menyalakan relai saat anomali masih aktif:
//    - 'auto'      : ditolak sampai nilai kembali normal.
//    - 'semi_auto' : boleh, tetapi hitung mundur baru dimulai (pengaman tetap berlaku).
//    Pindah ke 'auto' saat anomali aktif dan relai menyala juga memulai hitung mundur.
// 6. ESP32 punya proteksi lokal (batas kritis / backend tak terjangkau) yang memutus relai sendiri;
//    laporannya lewat telemetri dicatat sebagai perintah OFF bersumber 'local'.
// Semua keputusan mencatat pelaku (operator / sistem) dan mode saat itu.
// Berjalan di backend agar tetap bekerja walau tidak ada dashboard yang terbuka.
// Nilai detik harus sama dengan AUTO_CUT_SEC / DECISION_SEC di apps/web/src/lib/live/sync.ts.

export const AUTO_CUT_SEC = 10;
export const DECISION_SEC = 30;

interface PendingRec {
  id: number;
  deviceId: string;
  ts: number;
}

const pending = new Map<number, PendingRec>();
const modeCache = new Map<string, { mode: Mode; at: number }>();

export async function getMode(deviceId: string): Promise<Mode> {
  const hit = modeCache.get(deviceId);
  if (hit && Date.now() - hit.at < 10_000) return hit.mode;
  const { data, error } = await supabase.from('devices').select('mode').eq('id', deviceId).maybeSingle();
  if (error) throw error;
  const mode = (data?.mode as Mode) ?? 'semi_auto';
  modeCache.set(deviceId, { mode, at: Date.now() });
  return mode;
}

const LABEL: Record<AlertType, { name: string; unit: string; over: boolean }> = {
  undervoltage: { name: 'Tegangan', unit: 'V', over: false },
  overvoltage: { name: 'Tegangan', unit: 'V', over: true },
  overcurrent: { name: 'Arus', unit: 'A', over: true },
  overpower: { name: 'Daya', unit: 'W', over: true },
  overheat: { name: 'Suhu', unit: '°C', over: true },
  frequency: { name: 'Frekuensi', unit: 'Hz', over: true },
  power_factor: { name: 'Faktor daya', unit: '', over: false },
  energy_hourly: { name: 'Energi per jam', unit: 'Wh', over: true },
};

const num = (n: number) => (Math.abs(n) < 10 ? n.toFixed(Math.abs(n) < 1 ? 3 : 2) : n.toFixed(1)).replace('.', ',');

function describe(v: Violation): string {
  const l = LABEL[v.type];
  const over = v.type === 'frequency' ? v.value > v.threshold : l.over;
  const u = l.unit ? ` ${l.unit}` : '';
  return `${l.name} ${num(v.value)}${u} ${over ? 'di atas' : 'di bawah'} batas ${num(v.threshold)}${u}`;
}

async function finish(rec: PendingRec, status: 'executed' | 'dismissed' | 'expired', by: Actor = SYSTEM) {
  pending.delete(rec.id);
  const { error } = await supabase
    .from('recommendations').update({ status, decided_at: new Date().toISOString(), decided_by: by.actor })
    .eq('id', rec.id).eq('status', 'pending');
  if (error) throw error;
}

// source 'auto' = diputus sistem (mode otomatis atau pengaman semi-otomatis; dibedakan lewat kolom mode)
async function cut(rec: PendingRec, source: 'auto' | 'recommendation', by: Actor, mode: Mode) {
  const reason = source === 'auto'
    ? (mode === 'auto' ? 'Mode otomatis: anomali' : 'Pengaman: tidak ada keputusan dalam batas waktu')
    : 'Mengikuti rekomendasi sistem';
  await createRelayCommand(rec.deviceId, 'off', source, { by, mode, reason, recommendationId: rec.id });
  await finish(rec, 'executed', by);
}

// Alert pemicu pemutusan yang masih terbuka, langsung dari tabel alerts (sumber yang sama dengan dashboard).
async function openTripViolations(deviceId: string): Promise<Violation[]> {
  const { data, error } = await supabase
    .from('alerts').select('type,value,threshold').eq('device_id', deviceId).is('resolved_at', null);
  if (error) throw error;
  return (data ?? [])
    .filter((r) => !NO_TRIP.has(r.type as AlertType))
    .map((r) => ({ type: r.type as AlertType, value: r.value, threshold: r.threshold }));
}

// Membuat rekomendasi putus relai dan memulai hitung mundur (satu rekomendasi aktif per device).
async function openRecommendation(deviceId: string, violations: Violation[], log: FastifyBaseLogger) {
  if ([...pending.values()].some((p) => p.deviceId === deviceId)) return;
  const reason = violations.map(describe).join('; ');
  const { data, error } = await supabase
    .from('recommendations')
    .insert({ device_id: deviceId, action: 'relay_off', reason, source: 'rule', violations })
    .select('id,ts').single();
  if (error) throw error;
  pending.set(data.id, { id: data.id, deviceId, ts: Date.parse(data.ts) });
  log.warn({ deviceId, recommendationId: data.id, reason, mode: await getMode(deviceId) }, 'Anomali: rekomendasi putus relai');
}

// Dipanggil ingest saat ada alert yang baru terbuka.
export async function onViolationsOpened(deviceId: string, openedAll: Violation[], relayOn: boolean, log: FastifyBaseLogger) {
  const opened = openedAll.filter((v) => !NO_TRIP.has(v.type));
  if (!opened.length || !relayOn) return;
  if ((await desiredRelay(deviceId)) === 'off') return; // relai sudah diperintah OFF
  await openRecommendation(deviceId, opened, log);
}

setRelayPolicy({
  mode: getMode,
  async beforeOn(deviceId) {
    if ((await getMode(deviceId)) !== 'auto') return null;
    const active = await openTripViolations(deviceId);
    if (!active.length) return null;
    return `Mode otomatis: relai tidak bisa dinyalakan selama anomali masih aktif (${active.map(describe).join('; ')}). Tunggu sampai nilai kembali normal.`;
  },
  async afterOn(deviceId, log) {
    const active = await openTripViolations(deviceId);
    if (active.length) await openRecommendation(deviceId, active, log);
  },
});

// Proteksi lokal ESP32: relai sudah diputus oleh ESP32 sendiri. Dicatat sekali per kejadian
// (tripAt = millis() ESP32 saat memutus) agar keadaan yang diinginkan ikut OFF dan dashboard menampilkannya.
const handledLocalTrips = new Map<string, number>();
export async function onLocalTrip(deviceId: string, tripAt: number, reason: string, log: FastifyBaseLogger) {
  if (handledLocalTrips.get(deviceId) === tripAt) return;
  handledLocalTrips.set(deviceId, tripAt);
  if ((await desiredRelay(deviceId)) === 'off') return;
  const rec = [...pending.values()].find((p) => p.deviceId === deviceId);
  await createRelayCommand(deviceId, 'off', 'local', {
    by: ESP32_LOCAL, mode: await getMode(deviceId), reason, recommendationId: rec?.id,
  });
  if (rec) await finish(rec, 'executed', ESP32_LOCAL);
  log.warn({ deviceId, reason }, 'Relai diputus proteksi lokal ESP32');
}

// Dipanggil ingest saat semua nilai kembali normal (dengan data sensor lengkap).
export async function onAllClear(deviceId: string) {
  for (const rec of [...pending.values()]) if (rec.deviceId === deviceId) await finish(rec, 'expired');
}

const failures = new Map<number, number>();
const MAX_FAILURES = 5;

// Hitung mundur: dicek tiap detik. Tiap rekomendasi diproses terpisah agar satu kegagalan
// (mis. Supabase putus sesaat, atau device sudah dihapus) tidak menahan pemutusan rekomendasi lain.
async function tick(log: FastifyBaseLogger) {
  const now = Date.now();
  for (const rec of [...pending.values()]) {
    try {
      const mode = await getMode(rec.deviceId);
      const sec = mode === 'auto' ? AUTO_CUT_SEC : DECISION_SEC;
      if (now < rec.ts + sec * 1000) continue;
      await cut(rec, 'auto', SYSTEM, mode);
      failures.delete(rec.id);
      log.warn({ deviceId: rec.deviceId, recommendationId: rec.id, mode }, mode === 'auto'
        ? 'Relai diputus otomatis'
        : 'Relai diputus pengaman: tidak ada keputusan pengguna');
    } catch (err) {
      const n = (failures.get(rec.id) ?? 0) + 1;
      failures.set(rec.id, n);
      log.error({ err, recommendationId: rec.id, attempt: n }, 'Gagal memutus relai untuk rekomendasi');
      if (n >= MAX_FAILURES) {
        pending.delete(rec.id);
        failures.delete(rec.id);
        log.error({ recommendationId: rec.id }, 'Rekomendasi dilepas setelah gagal berulang');
      }
    }
  }
}

// Rekomendasi yang masih pending saat backend menyala ulang: lanjutkan bila masih baru, selebihnya kedaluwarsa.
async function restore() {
  const { data, error } = await supabase.from('recommendations').select('id,device_id,ts').eq('status', 'pending');
  if (error) throw error;
  for (const r of data ?? []) {
    const rec = { id: r.id, deviceId: r.device_id, ts: Date.parse(r.ts) };
    if (Date.now() - rec.ts < 2 * 60_000) pending.set(rec.id, rec);
    else await finish(rec, 'expired');
  }
}

// Ganti mode respons (dipanggil route admin). false = device tidak ditemukan.
// Pindah ke otomatis saat anomali masih aktif dan relai menyala: mulai hitung mundur pemutusan.
export async function changeMode(deviceId: string, mode: Mode, by: Actor, log: FastifyBaseLogger): Promise<boolean> {
  const prev = await getMode(deviceId);
  const { data, error } = await supabase.from('devices').update({ mode }).eq('id', deviceId).select('id');
  if (error) throw error;
  if (!data?.length) return false;
  modeCache.set(deviceId, { mode, at: Date.now() });
  if (prev !== mode) {
    const { error: e } = await supabase.from('mode_changes').insert({
      device_id: deviceId, mode, prev_mode: prev, actor: by.actor, actor_role: by.role, actor_id: by.id ?? null,
    });
    if (e) throw e;
    log.info({ deviceId, mode, actor: by.actor }, 'Mode respons diubah');
  }
  if (mode === 'auto' && (await desiredRelay(deviceId)) !== 'off') {
    const active = await openTripViolations(deviceId);
    if (active.length) await openRecommendation(deviceId, active, log);
  }
  return true;
}

type Params = { Params: { id: string; rid: string } };
const decisionBody = z.object({ pin: z.unknown() }).nullish();

export async function startAutomation(app: FastifyInstance) {
  await restore();
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    tick(app.log).catch((err) => app.log.error({ err }, 'Gagal memproses hitung mundur relai')).finally(() => { busy = false; });
  }, 1000);

  const findPending = (req: { params: { id: string; rid: string } }) => {
    const rec = pending.get(Number(req.params.rid));
    return rec && rec.deviceId === req.params.id ? rec : null;
  };

  // Keputusan operator atas rekomendasi. Keduanya menentukan listrik putus atau tetap menyala, jadi wajib PIN.
  const decide = (status: 'executed' | 'dismissed') => async (req: FastifyRequest<Params>, reply: FastifyReply) => {
    const user = await requireUser(req, reply, 'operator');
    if (!user) return;
    if (!(await requirePin(user, decisionBody.safeParse(req.body).data?.pin, reply))) return;
    const rec = findPending(req);
    if (!rec) return reply.code(409).send({ error: 'not_pending', message: 'Rekomendasi sudah selesai' });
    const by = actorOf(user);
    if (status === 'executed') await cut(rec, 'recommendation', by, await getMode(rec.deviceId));
    else await finish(rec, 'dismissed', by);
    return { ok: true };
  };

  app.post<Params>('/api/devices/:id/recommendations/:rid/execute', decide('executed'));
  app.post<Params>('/api/devices/:id/recommendations/:rid/dismiss', decide('dismissed'));
}
