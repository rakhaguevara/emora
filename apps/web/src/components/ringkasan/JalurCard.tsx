import { AlertTriangle, WifiOff } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/cn";
import { jalurLabel, STATUS_LABEL } from "@/lib/derive";
import { fmtNum } from "@/lib/format";
import type { Jalur, JalurStatus, Sample } from "@/lib/types";

const TONE: Record<JalurStatus, "success" | "warning" | "danger" | "neutral"> = {
  normal: "success", warning: "warning", trip: "danger", off: "neutral", offline: "neutral",
};

export function JalurCard({
  jalur, sample, status, onRelay,
}: {
  jalur: Jalur;
  sample: Sample | null;
  status: JalurStatus;
  onRelay: (next: boolean) => void;
}) {
  const on = jalur.relayOn && !!sample;
  const metrics: [string, string][] = [
    ["Tegangan", sample ? `${fmtNum(sample.voltage, 0)} V` : "—"],
    ["Arus", on ? `${fmtNum(sample!.current, 1)} A` : "—"],
    ["Daya", on ? `${fmtNum(sample!.power, 0)} W` : "—"],
    ["PF", on && sample!.pf != null ? fmtNum(sample!.pf, 2) : "—"],
  ];
  return (
    <article
      className={cn(
        "rounded-lg border bg-surface p-4",
        status === "trip" ? "border-danger-line" : status === "warning" ? "border-warning-line/60" : "border-line",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/jalur/${jalur.number}`} className="font-bold text-fg hover:text-primary">
            {jalurLabel(jalur)}
          </Link>
          <p className="text-xs text-fg-3">ID sensor {jalur.sensorId}</p>
        </div>
        <Switch label={`Relai ${jalurLabel(jalur)}`} checked={jalur.relayOn} onChange={onRelay} />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Badge
          tone={TONE[status]}
          icon={status === "trip" || status === "warning" ? <AlertTriangle className="h-3 w-3" /> : status === "offline" ? <WifiOff className="h-3 w-3" /> : undefined}
        >
          {STATUS_LABEL[status]}
        </Badge>
        <Link href={`/jalur/${jalur.number}`} className="text-[13px] font-semibold text-primary hover:underline">
          Detail
        </Link>
      </div>
      <dl className="mt-4 grid grid-cols-4 gap-2 border-t border-line pt-3 text-xs tabular-nums">
        {metrics.map(([k, v]) => (
          <div key={k}>
            <dt className="text-fg-3">{k}</dt>
            <dd className="mt-0.5 font-semibold text-fg">{v}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
