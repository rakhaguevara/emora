"use client";

import { Zap } from "lucide-react";
import { usePathname } from "next/navigation";
import { Menu } from "@/components/ui/Menu";
import { actions, useApp } from "@/lib/store";
import { ThemeToggle } from "./ThemeToggle";

function titleFor(path: string): string {
  if (path.startsWith("/jalur")) return "Detail Jalur";
  if (path.startsWith("/peringatan")) return "Peringatan & Kejadian";
  if (path.startsWith("/energi")) return "Energi & Efisiensi";
  if (path.startsWith("/perangkat")) return "Perangkat";
  return "Ringkasan";
}

export function Topbar() {
  const pathname = usePathname();
  const app = useApp();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-solid text-white lg:hidden">
        <Zap className="h-4 w-4" />
      </div>
      <p className="flex-1 truncate text-lg text-fg">{titleFor(pathname)}</p>
      <ThemeToggle />
      <Menu
        label="Menu pengguna"
        trigger={
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-soft text-[13px] font-semibold text-primary">
            {app?.user.initials ?? ""}
          </span>
        }
        items={[{ label: "Setel ulang data demo", onSelect: () => actions.resetDemo() }]}
      />
    </header>
  );
}
