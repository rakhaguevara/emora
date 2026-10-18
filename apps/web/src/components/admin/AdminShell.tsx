"use client";

import { Activity, Receipt, Server, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { UserMenu } from "@/components/auth/UserMenu";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/auth/session";

// Kerangka halaman admin: hanya pengelolaan data web dan akun, tanpa kontrol relai.
export const ADMIN_NAV = [
  { href: "/admin", label: "Akun", icon: Users, match: (p: string) => p === "/admin" },
  { href: "/admin/perangkat", label: "Perangkat", icon: Server, match: (p: string) => p.startsWith("/admin/perangkat") },
  { href: "/admin/tarif", label: "Tarif & Rekomendasi", icon: Receipt, match: (p: string) => p.startsWith("/admin/tarif") },
  { href: "/admin/aktivitas", label: "Aktivitas", icon: Activity, match: (p: string) => p.startsWith("/admin/aktivitas") },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const demo = useSession()?.token === null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-3 px-4 sm:px-6">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-solid text-white">
            <ShieldCheck className="h-[18px] w-[18px]" />
          </div>
          <div className="flex-1 leading-tight">
            <p className="text-[15px] font-bold tracking-[0.08em] text-fg">EMORA</p>
            <p className="text-xs text-fg-3">Panel Admin</p>
          </div>
          <ThemeToggle />
          <UserMenu />
        </div>
        <nav aria-label="Navigasi admin" className="mx-auto max-w-[1320px] overflow-x-auto px-2 sm:px-4">
          <ul className="flex gap-1">
            {ADMIN_NAV.map(({ href, label, icon: Icon, match }) => {
              const active = match(pathname);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2 border-b-2 px-3 py-2.5 text-[14px] whitespace-nowrap",
                      active ? "border-primary font-medium text-primary" : "border-transparent text-fg-2 hover:text-fg",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6">
        {demo ? <DemoNotice /> : children}
      </main>
    </div>
  );
}

// Data admin (akun, perangkat, audit) hanya ada di backend; sesi demo tidak punya token.
function DemoNotice() {
  return (
    <Card className="p-8 text-center">
      <p className="text-lg font-medium text-fg">Panel admin butuh mode live</p>
      <p className="mx-auto mt-2 max-w-md text-[13px] text-fg-3">
        Kelola akun, perangkat, dan aktivitas tersimpan di backend dan Supabase. Isi kunci Supabase di
        apps/web/.env.local, jalankan backend, lalu masuk dengan akun admin (buat yang pertama dengan npm run create-admin).
      </p>
    </Card>
  );
}
