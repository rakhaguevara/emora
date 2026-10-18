"use client";

import { Bell, BellOff, Zap } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { UserMenu } from "@/components/auth/UserMenu";
import { notificationsSupported, setNavigator } from "@/lib/live/notify";
import { actions, isLive, liveLinkStatus, useApp } from "@/lib/store";
import { toast } from "@/lib/toast";
import { ThemeToggle } from "./ThemeToggle";

function titleFor(path: string): string {
  if (path.startsWith("/jalur")) return "Detail Jalur";
  if (path.startsWith("/peringatan")) return "Peringatan & Kejadian";
  if (path.startsWith("/energi")) return "Energi & Efisiensi";
  if (path.startsWith("/perangkat")) return "Perangkat";
  return "Ringkasan";
}

// Tombol izin notifikasi sistem. Browser hanya mengizinkannya di localhost atau HTTPS.
function NotifyButton() {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("unsupported");
  useEffect(() => {
    // Status izin hanya bisa dibaca di browser; dibaca setelah mount agar tidak beda dengan render server.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPerm(notificationsSupported() ? Notification.permission : "unsupported");
  }, []);
  if (perm === "unsupported" || perm === "granted") return null;
  const blocked = perm === "denied";
  return (
    <button
      type="button"
      aria-label={blocked ? "Notifikasi diblokir browser" : "Aktifkan notifikasi"}
      title={blocked ? "Notifikasi diblokir. Izinkan lewat pengaturan situs di browser." : "Aktifkan notifikasi saat ada masalah"}
      onClick={async () => {
        if (blocked) return toast("Notifikasi diblokir. Izinkan lewat pengaturan situs di browser.", "info");
        const p = await Notification.requestPermission();
        setPerm(p);
        toast(p === "granted" ? "Notifikasi aktif" : "Notifikasi tidak diizinkan", p === "granted" ? "success" : "info");
      }}
      className="flex h-9 w-9 items-center justify-center rounded-full text-fg-2 hover:bg-surface-2 hover:text-fg"
    >
      {blocked ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
    </button>
  );
}

const LINK_LABEL = { realtime: "LIVE", polling: "LIVE · polling", connecting: "LIVE · menyambung" } as const;
const LINK_TITLE = {
  realtime: "Data asli dari ESP32, diterima seketika lewat WebSocket (Supabase Realtime)",
  polling: "WebSocket tidak tersambung; data diambil dari Supabase tiap 5 detik",
  connecting: "Menyambung ke Supabase Realtime",
} as const;

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const app = useApp();
  useEffect(() => setNavigator((href) => router.push(href)), [router]);
  const link = isLive && app ? liveLinkStatus() : "connecting";

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-solid text-white lg:hidden">
        <Zap className="h-4 w-4" />
      </div>
      <p className="flex-1 truncate text-lg text-fg">{titleFor(pathname)}</p>
      <span
        title={isLive ? LINK_TITLE[link] : "Data simulasi di browser"}
        className={
          !isLive
            ? "rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-fg-3"
            : link === "realtime"
              ? "rounded-full bg-success-soft px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-success"
              : "rounded-full bg-warning-soft px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-warning"
        }
      >
        {isLive ? LINK_LABEL[link] : "DEMO"}
      </span>
      {isLive && <NotifyButton />}
      <ThemeToggle />
      <UserMenu extraItems={isLive ? [] : [{ label: "Setel ulang data demo", onSelect: () => actions.resetDemo() }]} />
    </header>
  );
}
