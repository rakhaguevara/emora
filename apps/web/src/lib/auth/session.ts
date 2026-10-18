"use client";

import { useSyncExternalStore } from "react";

// Sesi login di browser. Token dari backend (POST /api/auth/login) disimpan di localStorage
// dan dikirim sebagai "Authorization: Bearer" oleh lib/api.ts. Backend tetap memeriksa peran di setiap permintaan.
// Mode demo (tanpa Supabase): sesi lokal tanpa token, hanya untuk mencoba tampilan.

export type Role = "admin" | "operator";

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

export interface Session {
  token: string | null; // null = sesi demo
  expiresAt: number;
  user: SessionUser;
}

const KEY = "emora.session";
const listeners = new Set<() => void>();
let cached: Session | null | undefined;

function read(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null") as Session | null;
    return s && s.expiresAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  if (cached === undefined) cached = read();
  return cached;
}

export function setSession(s: Session | null) {
  cached = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* penyimpanan diblokir: sesi hanya berlaku sampai halaman dimuat ulang */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  // Masuk/keluar di tab lain ikut berlaku di tab ini
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cached = read();
    l();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

// undefined = belum diketahui (render server / sebelum hidrasi); null = belum login
export function useSession(): Session | null | undefined {
  return useSyncExternalStore(subscribe, getSession, () => undefined);
}

export const roleHome = (role: Role) => (role === "admin" ? "/admin" : "/");

export const ROLE_LABEL: Record<Role, string> = { admin: "Admin", operator: "Operator" };

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
