import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../supabase.js';
import { DUMMY_HASH, verifySecret } from './crypto.js';
import { bearerToken, requireUser } from './guard.js';
import { createSession, purgeExpiredSessions, revokeSession, toAuthUser } from './sessions.js';
import { lockMessage, Throttle } from './throttle.js';

// Login sederhana username + password. Tidak ada pendaftaran mandiri: akun dibuat admin (admin/users.ts).
// POST /api/auth/login   { username, password } -> { token, expiresAt, user }
// POST /api/auth/logout  (Bearer)
// GET  /api/auth/me      (Bearer) -> user

const loginBody = z.object({
  username: z.string().trim().toLowerCase().min(1).max(32),
  password: z.string().min(1).max(200),
});

const loginThrottle = new Throttle();
const INVALID = { error: 'invalid_credentials', message: 'Username atau password salah' };

export function registerAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_payload', message: 'Isi username dan password' });
    const { username, password } = parsed.data;

    const locked = loginThrottle.lockedFor(username);
    if (locked) return reply.code(429).send({ error: 'locked', message: lockMessage(locked) });

    const { data: user, error } = await supabase
      .from('app_users').select('id,username,display_name,role,active,password_hash')
      .eq('username', username).maybeSingle();
    if (error) throw error;

    const ok = await verifySecret(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) {
      loginThrottle.fail(username);
      req.log.warn({ username }, 'Login gagal');
      return reply.code(401).send(INVALID);
    }
    if (!user.active) return reply.code(403).send({ error: 'inactive', message: 'Akun dinonaktifkan. Hubungi admin.' });

    loginThrottle.reset(username);
    const session = await createSession(user.id);
    await supabase.from('app_users').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);
    purgeExpiredSessions().catch((err) => req.log.error({ err }, 'Gagal membersihkan sesi kedaluwarsa'));
    req.log.info({ username, role: user.role }, 'Login berhasil');
    return { ...session, user: toAuthUser(user) };
  });

  app.post('/api/auth/logout', async (req) => {
    const token = bearerToken(req);
    if (token) await revokeSession(token);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const user = await requireUser(req, reply);
    return user ?? undefined;
  });
}
