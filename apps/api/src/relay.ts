import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorOf, requirePin, requireUser } from './auth/guard.js';
import { config } from './config.js';
import { supabase } from './supabase.js';

// Kontrol relai jarak jauh lewat tabel relay_commands.
// Dashboard  -> POST /api/devices/:id/relay        (sesi operator + PIN)  menyimpan perintah 'on'/'off'
// ESP32      -> GET  /api/devices/:id/relay        (x-device-key)   tiap 1 detik, mengambil perintah terakhir
// ESP32      -> POST /api/devices/:id/relay/ack    (x-device-key)   setelah GPIO relai ditulis
// Perintah terakhir = keadaan relai yang diinginkan, sehingga ESP32 yang baru menyala ikut keadaan itu.
// Tiap perintah mencatat pelaku (actor + actor_role), alasan, dan mode respons saat itu.

interface Command {
  id: number;
  action: 'on' | 'off';
  status: 'pending' | 'sent' | 'acked' | 'failed';
}

export type Mode = 'auto' | 'semi_auto';
export type Role = 'operator' | 'admin' | 'system';
export interface Actor {
  actor: string;
  role: Role;
  id?: string; // id akun (app_users) bila pelakunya pengguna yang login
}

export const SYSTEM: Actor = { actor: 'Sistem', role: 'system' };
export const ESP32_LOCAL: Actor = { actor: 'ESP32 (proteksi lokal)', role: 'system' };

// Perintah terakhir per device. Hanya backend yang menulis relay_commands, jadi cache ini selalu sesuai
// dan polling ESP32 tiap detik tidak perlu menunggu Supabase.
const latest = new Map<string, Command | null>();

async function getLatest(deviceId: string): Promise<Command | null> {
  if (latest.has(deviceId)) return latest.get(deviceId)!;
  const { data, error } = await supabase
    .from('relay_commands').select('id,action,status').eq('device_id', deviceId)
    .order('ts', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  latest.set(deviceId, (data as Command | null) ?? null);
  return latest.get(deviceId)!;
}

async function setStatus(deviceId: string, cmd: Command, status: Command['status']) {
  cmd.status = status;
  const { error } = await supabase
    .from('relay_commands')
    .update({ status, ...(status === 'acked' || status === 'failed' ? { acked_at: new Date().toISOString() } : {}) })
    .eq('id', cmd.id).eq('device_id', deviceId);
  if (error) throw error;
}

// Membuat perintah relai (dari pengguna, rekomendasi, mode otomatis, atau laporan proteksi lokal ESP32).
export async function createRelayCommand(
  deviceId: string,
  action: 'on' | 'off',
  source: 'user' | 'recommendation' | 'auto' | 'local',
  opts: { by: Actor; mode: Mode; reason?: string | null; recommendationId?: number },
) {
  const { data, error } = await supabase
    .from('relay_commands')
    .insert({
      device_id: deviceId, action, source, recommendation_id: opts.recommendationId ?? null,
      actor: opts.by.actor, actor_role: opts.by.role, actor_id: opts.by.id ?? null, reason: opts.reason ?? null, mode: opts.mode,
    })
    .select('id,ts,action,status').single();
  if (error) throw error;
  latest.set(deviceId, { id: data.id, action: data.action, status: data.status });
  return data as { id: number; ts: string; action: 'on' | 'off'; status: Command['status'] };
}

// Perintah terakhir yang diinginkan untuk relai (null = belum pernah ada perintah)
export async function desiredRelay(deviceId: string): Promise<'on' | 'off' | null> {
  return (await getLatest(deviceId))?.action ?? null;
}

// Aturan mode untuk perintah dari pengguna (diisi automation.ts).
// beforeOn: pesan penolakan, atau null bila boleh. afterOn: dipanggil setelah perintah ON tersimpan.
interface RelayPolicy {
  mode(deviceId: string): Promise<Mode>;
  beforeOn(deviceId: string): Promise<string | null>;
  afterOn(deviceId: string, log: FastifyBaseLogger): Promise<void>;
}
let policy: RelayPolicy = { mode: async () => 'semi_auto', beforeOn: async () => null, afterOn: async () => {} };
export function setRelayPolicy(p: RelayPolicy) {
  policy = p;
}

function deviceAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.headers['x-device-key'] === config.ingestApiKey) return true;
  void reply.code(401).send({ error: 'unauthorized' });
  return false;
}

// Alasan wajib untuk perintah dari operator; PIN diperiksa terpisah (requirePin)
const commandBody = z.object({
  action: z.enum(['on', 'off']),
  reason: z.string().trim().min(1, 'Alasan wajib diisi').max(300),
  pin: z.unknown(),
});
const ackBody = z.object({ command_id: z.number().int(), relay_on: z.boolean() });

type Params = { Params: { id: string } };

export function registerRelayRoutes(app: FastifyInstance) {
  app.post<Params>('/api/devices/:id/relay', async (req, reply) => {
    const user = await requireUser(req, reply, 'operator');
    if (!user) return;
    const parsed = commandBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', message: parsed.error.issues[0]?.message, issues: parsed.error.issues });
    }
    if (!(await requirePin(user, parsed.data.pin, reply))) return;

    const deviceId = req.params.id;
    const { data: dev, error: devErr } = await supabase.from('devices').select('id').eq('id', deviceId).maybeSingle();
    if (devErr) throw devErr;
    if (!dev) return reply.code(404).send({ error: 'unknown_device' });

    const on = parsed.data.action === 'on';
    if (on) {
      const blocked = await policy.beforeOn(deviceId);
      if (blocked) {
        req.log.warn({ deviceId, reason: blocked }, 'Perintah relai ON ditolak');
        return reply.code(409).send({ error: 'anomaly_active', message: blocked });
      }
    }
    const by = actorOf(user);
    const data = await createRelayCommand(deviceId, parsed.data.action, 'user', {
      by, mode: await policy.mode(deviceId), reason: parsed.data.reason,
    });
    req.log.info({ deviceId, command: data, actor: by.actor, reason: parsed.data.reason }, 'Perintah relai dibuat');
    if (on) await policy.afterOn(deviceId, req.log);
    return reply.code(201).send(data);
  });

  app.get<Params>('/api/devices/:id/relay', async (req, reply) => {
    if (!deviceAuth(req, reply)) return;
    const cmd = await getLatest(req.params.id);
    if (!cmd) return { command_id: null };
    if (cmd.status === 'pending') await setStatus(req.params.id, cmd, 'sent');
    return { command_id: cmd.id, action: cmd.action };
  });

  app.post<Params>('/api/devices/:id/relay/ack', async (req, reply) => {
    if (!deviceAuth(req, reply)) return;
    const parsed = ackBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_payload', issues: parsed.error.issues });
    const cmd = await getLatest(req.params.id);
    // Ack untuk perintah lama (sudah ada perintah yang lebih baru) cukup diabaikan
    if (!cmd || cmd.id !== parsed.data.command_id) return { ok: true, stale: true };
    // ON yang ditolak ESP32 (proteksi lokal masih aktif) tercatat 'failed'
    const ok = (cmd.action === 'on') === parsed.data.relay_on;
    await setStatus(req.params.id, cmd, ok ? 'acked' : 'failed');
    req.log.info({ deviceId: req.params.id, commandId: cmd.id, ok }, 'Perintah relai dikonfirmasi ESP32');
    return { ok };
  });
}
