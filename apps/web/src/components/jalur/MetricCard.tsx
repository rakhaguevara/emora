import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";

export function MetricCard({
  label, value, unit, limit, minMax, alert,
}: {
  label: string;
  value: string;
  unit: string;
  limit: string;
  minMax: string;
  alert: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface p-4",
        alert && "border-t-2 border-t-danger-solid",
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn("text-[13px]", alert ? "text-danger" : "text-fg-2")}>{label}</span>
        {alert && <AlertTriangle aria-label="Di luar batas" className="h-4 w-4 text-danger" />}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[26px] leading-none font-semibold text-fg">{value}</span>
        <span className="text-[13px] text-fg-3">{unit}</span>
      </div>
      <p className="mt-2 text-xs text-fg-3">{limit}</p>
      <div className="mt-3 border-t border-line pt-3">
        <p className="text-xs text-fg-3">Min / maks 24 j</p>
        <p className="mt-0.5 text-[13px] font-bold text-fg tabular-nums">{minMax}</p>
      </div>
    </div>
  );
}
