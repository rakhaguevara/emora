import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { RequireRole } from "@/components/auth/RequireRole";

// Halaman admin: kelola akun, data perangkat, tarif, dan melihat aktivitas. Tidak ada kontrol relai.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireRole role="admin">
      <AdminShell>{children}</AdminShell>
    </RequireRole>
  );
}
