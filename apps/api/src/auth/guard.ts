import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Actor } from '../relay.js';
import { supabase } from '../supabase.js';
import { PIN_LENGTH, verifySecret } from './crypto.js';
import { userFromToken, type AuthUser, type UserRole } from './sessions.js';
import { lockMessage, Throttle } from './throttle.js';

// Pemeriksaan akses untuk endpoint dashboard:
// - requireUser: header "Authorization: Bearer <token>" dari sesi login, opsional dibatasi peran.
// - requirePin : PIN kontrol milik operator yang login, wajib untuk setiap tindakan ON/OFF relai.

export function bearerToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() || null : null;
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply, role?: UserRole): Promise<AuthUser | null> {
  const token = bearerToken(req);
  const user = token ? await userFromToken(token) : null;
  if (!user) {
    void reply.code(401).send({ error: 'unauthenticated', message: 'Sesi berakhir. Silakan masuk lagi.' });
    return null;
  }
  if (role && user.role !== role) {
    void reply.code(403).send({ error: 'forbidden', message: `Hanya ${role} yang boleh melakukan tindakan ini` });
    return null;
  }
  return user;
}

const pinThrottle = new Throttle();
export const pinSchema = z.string().regex(new RegExp(`^\\d{${PIN_LENGTH}}$`), `PIN harus ${PIN_LENGTH} digit angka`);

// Memeriksa PIN operator. Salah 5 kali berturut-turut: kontrol relai akun itu dikunci 5 menit.
export async function requirePin(user: AuthUser, pin: unknown, reply: FastifyReply): Promise<boolean> {
  const locked = pinThrottle.lockedFor(user.id);
  if (locked) {
    void reply.code(429).send({ error: 'pin_locked', message: lockMessage(locked) });
    return false;
  }
  const parsed = pinSchema.safeParse(pin);
  if (!parsed.success) {
    void reply.code(400).send({ error: 'invalid_pin', message: parsed.error.issues[0]?.message });
    return false;
  }
  const { data, error } = await supabase.from('app_users').select('pin_hash').eq('id', user.id).maybeSingle();
  if (error) throw error;
  if (data?.pin_hash && (await verifySecret(parsed.data, data.pin_hash))) {
    pinThrottle.reset(user.id);
    return true;
  }
  const left = pinThrottle.fail(user.id);
  void reply.code(403).send({
    error: 'wrong_pin',
    message: left ? `PIN salah. Sisa ${left} percobaan.` : lockMessage(pinThrottle.lockedFor(user.id)),
  });
  return false;
}

// Pelaku tindakan untuk jejak audit
export const actorOf = (user: AuthUser): Actor => ({ actor: user.displayName, role: user.role, id: user.id });
