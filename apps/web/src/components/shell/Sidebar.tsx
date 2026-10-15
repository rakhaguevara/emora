"use client";

import { Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { activeCount, useApp } from "@/lib/store";
import { NAV } from "./nav";

export function Sidebar() {
  const pathname = usePathname();
  const app = useApp();
  const alerts = app ? activeCount(app) : 0;

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center gap-3 px-4 pt-5 pb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-solid text-white">
          <Zap className="h-5 w-5" />
        </div>
        <div>
          <div className="text-[17px] leading-5 font-bold tracking-[0.08em] text-fg">EMORA</div>
          <div className="text-xs text-fg-3">Energy Copilot</div>
        </div>
      </div>

      <nav aria-label="Navigasi utama" className="flex-1 space-y-1 px-3">
        {NAV.map(({ href, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-[14px] leading-tight",
                active ? "bg-primary-soft font-medium text-primary" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <span className="flex-1">{label}</span>
              {href === "/peringatan" && alerts > 0 && (
                <span
                  aria-label={`${alerts} peringatan aktif`}
                  className="flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-solid px-1.5 text-[11px] font-bold text-white"
                >
                  {alerts}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3 p-3">
        <div className="rounded-lg border border-line bg-surface p-3.5">
          <div className="text-[11px] font-semibold tracking-wider text-fg-3 uppercase">Fasilitas aktif</div>
          <div className="mt-1 text-[15px] font-semibold text-fg">{app?.facility.name ?? "—"}</div>
          <div className="text-[13px] text-fg-3">{app?.facility.panelName ?? ""}</div>
        </div>
        <div className="flex items-center gap-2 px-1 text-[13px] text-fg-2">
          <span className="h-2 w-2 rounded-full bg-success" />
          Sistem terhubung
        </div>
      </div>
    </div>
  );
}
