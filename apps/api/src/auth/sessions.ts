import { supabase } from '../supabase.js';
import { newSessionToken, sha256 } from './crypto.js';

// Sesi login: token acak dipegang browser, database hanya menyimpan hash-nya.
// Menonaktifkan atau menghapus akun langsung mencabut semua sesinya.

export type UserRole = 'admin' | 'operator';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export const SESSION_TTL_MS = 12 * 60 * 60_000;

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  active: boolean;
}

export const toAuthUser = (u: UserRow): AuthUser => ({
  id: u.id, username: u.username, displayName: u.display_name, role: u.role,
});

export async function createSession(userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { error } = await supabase.from('app_sessions').insert({ token_hash: sha256(token), user_id: userId, expires_at: expiresAt });
  if (error) throw error;
  return { token, expiresAt };
}

export async function userFromToken(token: string): Promise<AuthUser | null> {
  const { data, error } = await supabase
    .from('app_sessions')
    .select('expires_at, app_users!inner(id,username,display_name,role,active)')
    .eq('token_hash', sha256(token))
    .maybeSingle();
  if (error) throw error;
  if (!data || Date.parse(data.expires_at) <= Date.now()) return null;
  const user = data.app_users as unknown as UserRow;
  return user.active ? toAuthUser(user) : null;
}

export async function revokeSession(token: string) {
  const { error } = await supabase.from('app_sessions').delete().eq('token_hash', sha256(token));
  if (error) throw error;
}

export async function revokeUserSessions(userId: string) {
  const { error } = await supabase.from('app_sessions').delete().eq('user_id', userId);
  if (error) throw error;
}

export async function purgeExpiredSessions() {
  const { error } = await supabase.from('app_sessions').delete().lt('expires_at', new Date().toISOString());
  if (error) throw error;
}
