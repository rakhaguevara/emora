import { AlertTriangle, User, WifiOff } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { eventJalurLabel } from "@/lib/derive";
import { dayDiff, fmtDay, fmtHM, fmtNum } from "@/lib/format";
import type { AlertEvent, AppState } from "@/lib/types";

const TILE: Record<string, { cls: string; icon: ReactNode }> = {
  trip: { cls: "bg-danger-soft text-danger", icon: <AlertTriangle className="h-[18px] w-[18px]" /> },
  warning: { cls: "bg-warning-soft text-warning", icon: <AlertTriangle className="h-[18px] w-[18px]" /> },
  offline: { cls: "bg-surface-2 text-fg-3", icon: <WifiOff className="h-[18px] w-[18px]" /> },
  manual: { cls: "bg-primary-soft text-primary", icon: <User className="h-[18px] w-[18px]" /> },
};

function copy(app: AppState, e: AlertEvent): { title: string; sub: string } {
  const j = app.jalur.find((x) => x.id === e.jalurId);
  const name = j ? `Jalur ${j.number}` : eventJalurLabel(app, e);
  const d = e.unit === "W" ? 0 : e.unit === "" ? 2 : 1;
  const u = e.unit ? ` ${e.unit}` : "";
  const val = e.value != null && e.limit != null ? `${e.param} ${fmtNum(e.value, d)}${u}` : e.param;
  switch (e.type) {
    case "trip":
      return { title: `${name} trip`, sub: e.value != null && e.limit != null ? `${val} > ${fmtNum(e.limit, d)}${u}` : e.param };
    case "offline":
      return { title: `${name} offline`, sub: "Tidak ada data dari sensor" };
    case "manual":
      return { title: `${name} dimatikan`, sub: e.handledBy ? `Oleh ${e.handledBy}` : "Oleh pengguna" };
    default:
      return {
        title: `${name} peringatan`,
        sub: e.value != null && e.limit != null ? `${val} (batas ${fmtNum(e.limit, d)}${u})` : e.param,
      };
  }
}

export function RecentEvents({ app, now }: { app: AppState; now: number }) {
  const items = [...app.events]
    .filter((e) => e.type !== "config")
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, 3);

  return (
    <section className="h-full rounded-lg border border-line bg-surface p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-medium text-fg">Kejadian terbaru</h2>
        <Link href="/peringatan" className="text-[15px] font-semibold text-primary hover:underline">
          Semua
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="mt-6 text-[13px] text-fg-3">Belum ada kejadian.</p>
      ) : (
        <ul className="mt-5">
          {items.map((e, i) => {
            const { title, sub } = copy(app, e);
            const tile = TILE[e.type];
            const j = app.jalur.find((x) => x.id === e.jalurId);
            const body = (
              <>
                <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", tile.cls)}>{tile.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-fg">{title}</span>
                  <span className="block truncate text-[13px] text-fg-2">{sub}</span>
                </span>
                <span className="shrink-0 text-[13px] text-fg-3 tabular-nums">
                  {dayDiff(now, e.startedAt) === 0 ? fmtHM(e.startedAt) : fmtDay(e.startedAt)}
                </span>
              </>
            );
            const cls = cn("flex items-center gap-3.5 py-3.5", i > 0 && "border-t border-line");
            return (
              <li key={e.id}>
                {j ? (
                  <Link href={`/jalur/${j.number}`} className={cn(cls, "-mx-2 rounded-md px-2 hover:bg-surface-2")}>
                    {body}
                  </Link>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
