import { cn } from "@/lib/cn";
import { Radar } from "./Radar";
import type { JalurStatus } from "@/lib/types";

const DOT: Record<JalurStatus, string> = {
  normal: "bg-success",
  warning: "bg-warning-line",
  trip: "bg-danger-solid",
  offline: "bg-fg-3",
  off: "border border-fg-3 bg-transparent",
};
const LABEL: Record<JalurStatus, string> = {
  normal: "Normal",
  warning: "Peringatan",
  trip: "Trip",
  offline: "Offline",
  off: "Relai OFF",
};
const ORDER: JalurStatus[] = ["normal", "warning", "trip", "offline", "off"];

export function PanelStrip({
  panelName,
  updated,
  counts,
}: {
  panelName: string;
  updated: string;
  counts: Record<JalurStatus, number>;
}) {
  const anomalies = counts.warning + counts.trip;
  const shown = ORDER.filter((s) => counts[s] > 0 || s === "normal");
  return (
    <section className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-line bg-surface px-5 py-4">
      <div className="flex items-center gap-3.5">
        <Radar alert={anomalies > 0} />
        <div>
          <h2 className="text-[17px] leading-tight font-bold text-fg">{panelName}</h2>
          <p className={cn("text-[13px]", anomalies > 0 ? "font-medium text-danger" : "text-fg-3")}>
            {anomalies > 0 ? `${anomalies} jalur bermasalah` : "Semua aman"} · diperbarui {updated}
          </p>
        </div>
      </div>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-fg-2" aria-label="Ringkasan status jalur">
        {shown.map((s) => (
          <li key={s} className="inline-flex items-center gap-2">
            <span aria-hidden className={cn("h-2 w-2 rounded-full", DOT[s])} />
            <span className="tabular-nums">{counts[s]}</span> {LABEL[s]}
          </li>
        ))}
      </ul>
    </section>
  );
}
