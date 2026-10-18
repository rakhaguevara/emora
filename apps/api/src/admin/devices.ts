import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf, requireUser } from '../auth/guard.js';
import { changeMode } from '../automation.js';
import { invalidateThresholds } from '../ingest.js';
import { thresholdsSchema } from '../schema.js';
import { supabase } from '../supabase.js';

// Kelola data perangkat (khusus admin).
// GET   /api/admin/devices
// POST  /api/admin/devices            { id, name, location? }
// PATCH /api/admin/devices/:id        { name?, location?, thresholds? }
// POST  /api/admin/devices/:id/mode   { mode }
// GET   /api/admin/audit?limit=100    perintah relai + ganti mode, terbaru dulu

const DEVICE_COLUMNS = 'id,name,location,thresholds,mode,last_seen,created_at';

const validThresholds = thresholdsSchema
  .refine((t) => t.volt_min < t.volt_max, { message: 'Tegangan min. harus lebih kecil dari maks.' })
  .refine((t) => t.freq_min < t.freq_max, { message: 'Frekuensi min. harus lebih kecil dari maks.' })
  .refine((t) => t.pf_min >= 0 && t.pf_min <= 1, { message: 'PF min. harus 0–1' })
  .refine((t) => [t.current_max, t.power_max, t.temp_max, t.energy_hourly_max_wh].every((n) => n > 0), {
    message: 'Batas arus, daya, suhu, dan energi harus lebih dari 0',
  });

const name = z.string().trim().min(1, 'Nama wajib diisi').max(60);
const location = z.string().trim().max(120).nullable().optional();
const createBody = z.object({
  id: z.string().trim().regex(/^[a-z0-9-]{3,64}$/, 'ID 3–64 karakter: huruf kecil, angka, minus (sama dengan DEVICE_ID firmware)'),
  name,
  location,
});
const updateBody = z.object({ name: name.optional(), location, thresholds: validThresholds.optional() });
const modeBody = z.object({ mode: z.enum(['auto', 'semi_auto']) });

type Params = { Params: { id: string } };

function firstIssue(err: z.ZodError) {
  return { error: 'invalid_payload', message: err.issues[0]?.message ?? 'Data tidak valid' };
}

export function registerAdminDeviceRoutes(app: FastifyInstance) {
  app.get('/api/admin/devices', async (req, reply) => {
    if (!(await requireUser(req, reply, 'admin'))) return;
    const { data, error } = await supabase.from('devices').select(DEVICE_COLUMNS).order('created_at');
    if (error) throw error;
    return data;
  });

  app.post('/api/admin/devices', async (req, reply) => {
    const admin = await requireUser(req, reply, 'admin');
    if (!admin) return;
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(firstIssue(parsed.error));
    const { data, error } = await supabase.from('devices')
      .insert({ ...parsed.data, location: parsed.data.location || null }).select(DEVICE_COLUMNS).single();
    if (error?.code === '23505') return reply.code(409).send({ error: 'duplicate', message: 'ID perangkat sudah terdaftar' });
    if (error) throw error;
    req.log.info({ by: admin.username, deviceId: data.id }, 'Perangkat ditambahkan');
    return reply.code(201).send(data);
  });

  app.patch<Params>('/api/admin/devices/:id', async (req, reply) => {
    const admin = await requireUser(req, reply, 'admin');
    if (!admin) return;
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(firstIssue(parsed.error));
    const changes = { ...parsed.data, ...(parsed.data.location !== undefined && { location: parsed.data.location || null }) };
    const { data, error } = await supabase.from('devices').update(changes).eq('id', req.params.id).select(DEVICE_COLUMNS);
    if (error) throw error;
    if (!data?.length) return reply.code(404).send({ error: 'unknown_device', message: 'Perangkat tidak ditemukan' });
    if (parsed.data.thresholds) invalidateThresholds(req.params.id);
    req.log.info({ by: admin.username, deviceId: req.params.id, changes }, 'Perangkat diubah');
    return data[0];
  });

  app.post<Params>('/api/admin/devices/:id/mode', async (req, reply) => {
    const admin = await requireUser(req, reply, 'admin');
    if (!admin) return;
    const parsed = modeBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(firstIssue(parsed.error));
    const ok = await changeMode(req.params.id, parsed.data.mode, actorOf(admin), req.log);
    if (!ok) return reply.code(404).send({ error: 'unknown_device', message: 'Perangkat tidak ditemukan' });
    return { id: req.params.id, mode: parsed.data.mode };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/admin/audit', async (req, reply) => {
    if (!(await requireUser(req, reply, 'admin'))) return;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const [cmds, modes] = await Promise.all([
      supabase.from('relay_commands')
        .select('id,ts,device_id,action,source,status,actor,actor_role,reason,mode')
        .order('ts', { ascending: false }).limit(limit),
      supabase.from('mode_changes')
        .select('id,ts,device_id,mode,prev_mode,actor,actor_role')
        .order('ts', { ascending: false }).limit(limit),
    ]);
    if (cmds.error) throw cmds.error;
    if (modes.error) throw modes.error;
    return {
      commands: cmds.data,
      mode_changes: modes.data,
    };
  });
}
