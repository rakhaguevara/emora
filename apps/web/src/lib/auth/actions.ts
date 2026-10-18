"use client";

import { api } from "../api";
import { LIVE_ENABLED } from "../live/sync";
import { getSession, setSession, type Role, type Session, type SessionUser } from "./session";

// Masuk / keluar. Akun hanya dibuat admin; tidak ada pendaftaran mandiri.

export const DEMO_PIN = "123456";

export async function login(username: string, password: string): Promise<SessionUser> {
  const res = await api<{ token: string; expiresAt: string; user: SessionUser }>("POST", "/api/auth/login", { username, password });
  setSession({ token: res.token, expiresAt: Date.parse(res.expiresAt), user: res.user });
  return res.user;
}

// Mode demo: data simulasi, tanpa backend. Sesi berlaku 12 jam.
export function loginDemo(role: Role): SessionUser {
  const user: SessionUser = {
    id: `demo-${role}`, username: `demo-${role}`, role,
    displayName: role === "admin" ? "Admin Demo" : "Operator Demo",
  };
  setSession({ token: null, expiresAt: Date.now() + 12 * 3600e3, user } satisfies Session);
  return user;
}

export async function logout() {
  const token = getSession()?.token;
  setSession(null);
  if (token) await api("POST", "/api/auth/logout").catch(() => {});
}

// Memastikan sesi masih berlaku di backend (akun bisa dinonaktifkan admin kapan saja).
// 401 ditangani api(): sesi dihapus dan pengguna diarahkan ke halaman login.
export async function refreshSession() {
  const s = getSession();
  if (!s?.token || !LIVE_ENABLED) return;
  try {
    const user = await api<SessionUser>("GET", "/api/auth/me");
    if (user.displayName !== s.user.displayName || user.role !== s.user.role) setSession({ ...s, user });
  } catch {
    /* backend tidak terjangkau: sesi lokal tetap dipakai, tindakan akan gagal dengan pesan jelas */
  }
}

export const isDemoSession = () => getSession()?.token === null;
