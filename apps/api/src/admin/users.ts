import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generatePin, hashSecret } from '../auth/crypto.js';
import { requireUser } from '../auth/guard.js';
import { revokeUserSessions } from '../auth/sessions.js';
import { supabase } from '../supabase.js';

// Kelola akun (khusus admin). Tidak ada pendaftaran mandiri: semua akun dibuat di sini.
// PIN kontrol operator dibuat server dan hanya ditampilkan sekali (saat dibuat / direset).
// GET    /api/admin/users
// POST   /api/admin/users                  { username, display_name, role, password } -> { user, pin? }
// PATCH  /api/admin/users/:uid             { display_name?, active? }
// POST   /api/admin/users/:uid/password    { password }
// POST   /api/admin/users/:uid/pin         -> { pin }
// DELETE /api/admin/users/:uid

const USER_COLUMNS = 'id,username,display_name,role,active,created_at,last_login_at';

const username = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, 'Username 3–32 karakter: huruf kecil, angka, titik, minus, garis bawah');
const displayName = z.string().trim().min(1, 'Nama wajib diisi').max(60);
const password = z.string().min(8, 'Password minimal 8 karakter').max(200);

const createBody = z.object({
  username,
  display_name: displayName,
  role: z.enum(['admin', 'operator']),
  password,
});
const updateBody = z.object({ display_name: displayName.optional(), active: z.boolean().optional() });
const passwordBody = z.object({ password });

type Params = { Params: { uid: string } };

function firstIssue(err: z.ZodError) {
  return { error: 'invalid_payload', message: err.issues[0]?.message ?? 'Data tidak valid' };
}

export function registerAdminUserRoutes(app: FastifyInstance) {
  app.get('/api/admin/users', async (req, reply) => {
    if (!(await requireUser(req, reply, 'admin'))) return;
    const { data, error } = await supabase.from('app_users').select(USER_COLUMNS).order('created_at');
    if (error) throw error;
    return data;
  });

  app.post('/api/admin/users', async (req, reply) => {
    const admin = await requireUser(req, reply, 'admin');
    if (!admin) return;
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(firstIssue(parsed.error));
    const b = parsed.data;

    const pin = b.role === 'operator' ? generatePin() : null;
    const { data, error } = await supabase.from('app_users').insert({
      username: b.username,
      display_name: b.display_name,
      role: b.role,
      password_hash: await hashSecret(b.password),
      pin_hash: pin ? await hashSecret(pin) : null,
      created_by: admin.id,
    }).select(USER_COLUMNS).single();
    if (error?.code === '23505') return reply.code(409).send({ error: 'duplicate', message: 'Username sudah dipakai' });
    if (error) throw error;
    req.log.info({ by: admin.username, username: b.username, role: b.role }, 'Akun dibuat');
    return reply.code(201).send({ user: data, pin });
  });

  app.patch<Params>('/api/admin/users/:uid', async (req, reply) => {
    const admin = await requireUser(req, reply, 'admin');
    if (!admin) return;
    const parsed = updateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(firstIssue(parsed.error));
    if (parsed.data.active === false && req.params.uid === admin.id) {
      return reply.code(409).send({ error: 'self', message: 'Tidak bisa menonaktifkan akun sendiri' });
    }
    const { data, error } = await supabase.from('app_users').update(parsed.data).eq('id', req.params.uid).select(USER_COLUMNS);
    if (error) throw error;
    if (!data?.length) return reply.code(404).send({ error: 'not_found', message: 'Akun tidak ditemukan' });
    if (parsed.data.active === false) await revokeUserSessions(req.params.uid);
    req.log.info({ by: admin.username, uid: req.params.uid, changes: parsed.data }, 'Akun diubah');
    return data[0];
  });

  app.post<Params>('/api/admin/users/:uid/password', async (req, reply) => {
    const admin = await requireUser(req, reply, 'admin');
    if (!admin) return;
    const parsed = passwordBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(firstIssue(parsed.error));
    const { data, error } = await supabase.from('app_users')
      .update({ password_hash: await hashSecret(parsed.data.password) }).eq('id', req.params.uid).select('id');
    if (error) throw error;
    if (!data?.length) return reply.code(404).send({ error: 'not_found', message: 'Akun tidak ditemukan' });
    // Sesi lama dicabut agar password baru langsung berlaku (kecuali admin mengganti password sendiri)
    if (req.params.uid !== admin.id) await revokeUserSessions(req.params.uid);
    req.log.info({ by: admin.username, uid: req.params.uid }, 'Password direset');
    return { ok: true };
  });

  app.post<Params>('/api/admin/users/:uid/pin', async (req, reply) => {
    const admin = await requireUser(req, reply, 'admin');
    if (!admin) return;
    const { data: user, error } = await supabase.from('app_users').select('role').eq('id', req.params.uid).maybeSingle();
    if (error) throw error;
    if (!user) return reply.code(404).send({ error: 'not_found', message: 'Akun tidak ditemukan' });
    if (user.role !== 'operator') return reply.code(409).send({ error: 'not_operator', message: 'PIN hanya untuk akun operator' });
    const pin = generatePin();
    const { error: e } = await supabase.from('app_users').update({ pin_hash: await hashSecret(pin) }).eq('id', req.params.uid);
    if (e) throw e;
    req.log.info({ by: admin.username, uid: req.params.uid }, 'PIN operator direset');
    return { pin };
  });

  app.delete<Params>('/api/admin/users/:uid', async (req, reply) => {
    const admin = await requireUser(req, reply, 'admin');
    if (!admin) return;
    if (req.params.uid === admin.id) return reply.code(409).send({ error: 'self', message: 'Tidak bisa menghapus akun sendiri' });
    // Jejak audit tetap ada: kolom actor (nama) tersimpan, actor_id menjadi null.
    const { data, error } = await supabase.from('app_users').delete().eq('id', req.params.uid).select('username');
    if (error) throw error;
    if (!data?.length) return reply.code(404).send({ error: 'not_found', message: 'Akun tidak ditemukan' });
    req.log.info({ by: admin.username, username: data[0].username }, 'Akun dihapus');
    return { ok: true };
  });
}
