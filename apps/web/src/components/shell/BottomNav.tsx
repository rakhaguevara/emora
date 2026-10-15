"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { activeCount, useApp } from "@/lib/store";
import { NAV } from "./nav";

// Navigasi tab untuk layar < lg (gaya aplikasi); sidebar dipakai di layar lebar.
export function BottomNav() {
  const pathname = usePathname();
  const app = useApp();
  const alerts = app ? activeCount(app) : 0;

  return (
    <nav
      aria-label="Navigasi utama"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="grid grid-cols-4">
        {NAV.map(({ href, short, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                  active ? "text-primary" : "text-fg-3",
                )}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {href === "/peringatan" && alerts > 0 && (
                    <span
                      aria-label={`${alerts} peringatan aktif`}
                      className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-solid px-1 text-[10px] font-bold text-white"
                    >
                      {alerts}
                    </span>
                  )}
                </span>
                {short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
