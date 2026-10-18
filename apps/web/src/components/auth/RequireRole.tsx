"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { refreshSession } from "@/lib/auth/actions";
import { roleHome, useSession, type Role, type Session } from "@/lib/auth/session";
import { LIVE_ENABLED } from "@/lib/live/sync";

// Sesi demo (tanpa token) hanya berlaku di mode demo; di mode live wajib login ke backend.
const validFor = (s: Session | null | undefined): s is Session => !!s && (!LIVE_ENABLED || s.token !== null);

// Menampilkan halaman hanya untuk peran tertentu. Belum login -> /login; peran lain -> beranda perannya.
// Ini hanya untuk tampilan: backend tetap memeriksa sesi dan peran di setiap permintaan.
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const allowed = validFor(session) && session.user.role === role;

  useEffect(() => {
    if (session === undefined) return;
    if (!validFor(session)) router.replace("/login");
    else if (session.user.role !== role) router.replace(roleHome(session.user.role));
  }, [session, role, router]);

  useEffect(() => {
    if (allowed) void refreshSession();
  }, [allowed]);

  if (!allowed) {
    return (
      <div aria-busy="true" className="flex min-h-screen items-center justify-center text-[13px] text-fg-3">
        Memeriksa sesi...
      </div>
    );
  }
  return children;
}
