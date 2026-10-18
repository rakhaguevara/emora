import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireUser } from './auth/guard.js';
import { supabase } from './supabase.js';

// Tarif listrik dan rekomendasi harian (khusus admin yang login):
// PATCH  /api/admin/devices/:id/tariff          { tariff_class, tariff_per_kwh, tax_percent }
// POST   /api/admin/devices/:id/tips            { day, title, body?, saving_kwh_per_day? }
// PATCH  /api/admin/devices/:id/tips/:tipId
// DELETE /api/admin/devices/:id/tips/:tipId
// Dashboard membaca hasilnya langsung dari Supabase (kolom tarif di devices, tabel daily_tips).

const tariffBody = z.object({
  tariff_class: z.string().trim().min(1, 'Golongan wajib diisi').max(60),
  tariff_per_kwh: z.number().positive('Tarif harus lebih dari 0').max(100_000),
  tax_percent: z.number().min(0).max(30, 'Pajak maks. 30%'),
});

const tipBody = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal harus YYYY-MM-DD'),
  title: z.string().trim().min(1, 'Judul wajib diisi').max(120),
  body: z.string().trim().max(1000).default(''),
  saving_kwh_per_day: z.number().min(0).max(10_000).nullable().optional(),
});

type Params = { Params: { id: string } };
type TipParams = { Params: { id: string; tipId: string } };

function invalid(reply: FastifyReply, err: z.ZodError) {
  return reply.code(400).send({ error: 'invalid_payload', message: err.issues[0]?.message ?? 'Data tidak valid' });
}

export function registerAdminRoutes(app: FastifyInstance) {
  app.patch<Params>('/api/admin/devices/:id/tariff', async (req, reply) => {
    const user = await requireUser(req, reply, 'admin');
    if (!user) return;
    const parsed = tariffBody.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const { data, error } = await supabase
      .from('devices').update(parsed.data).eq('id', req.params.id)
      .select('tariff_class,tariff_per_kwh,tax_percent').maybeSingle();
    if (error) throw error;
    if (!data) return reply.code(404).send({ error: 'unknown_device', message: 'Perangkat tidak ditemukan' });
    req.log.info({ deviceId: req.params.id, ...parsed.data, actor: user.displayName }, 'Tarif diubah admin');
    return data;
  });

  app.post<Params>('/api/admin/devices/:id/tips', async (req, reply) => {
    const user = await requireUser(req, reply, 'admin');
    if (!user) return;
    const parsed = tipBody.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const { data, error } = await supabase
      .from('daily_tips')
      .insert({ device_id: req.params.id, ...parsed.data, created_by: user.displayName })
      .select('*').single();
    if (error?.code === '23503') return reply.code(404).send({ error: 'unknown_device', message: 'Perangkat tidak ditemukan' });
    if (error) throw error;
    return reply.code(201).send(data);
  });

  app.patch<TipParams>('/api/admin/devices/:id/tips/:tipId', async (req, reply) => {
    const user = await requireUser(req, reply, 'admin');
    if (!user) return;
    const parsed = tipBody.safeParse(req.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    const { data, error } = await supabase
      .from('daily_tips')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', Number(req.params.tipId)).eq('device_id', req.params.id)
      .select('*').maybeSingle();
    if (error) throw error;
    if (!data) return reply.code(404).send({ error: 'not_found', message: 'Rekomendasi tidak ditemukan' });
    return data;
  });

  app.delete<TipParams>('/api/admin/devices/:id/tips/:tipId', async (req, reply) => {
    const user = await requireUser(req, reply, 'admin');
    if (!user) return;
    const { error } = await supabase
      .from('daily_tips').delete().eq('id', Number(req.params.tipId)).eq('device_id', req.params.id);
    if (error) throw error;
    return reply.code(204).send();
  });
}
