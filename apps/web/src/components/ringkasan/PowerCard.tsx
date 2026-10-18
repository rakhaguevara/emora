import { cn } from "@/lib/cn";
import { fmtHM, fmtNum, fmtSmart } from "@/lib/format";

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-[13px] text-fg-3">{label}</dt>
      <dd className="mt-1 text-[15px] font-bold text-fg tabular-nums">{value}</dd>
      {sub && <dd className="text-xs text-fg-3 tabular-nums">{sub}</dd>}
    </div>
  );
}

export function PowerCard({
  watts, limitW, peak, avg1h, active, total, avgVoltage,
}: {
  watts: number;
  limitW: number;
  peak: { w: number; ts: number } | null;
  avg1h: number | null;
  active: number;
  total: number;
  avgVoltage: number | null;
}) {
  const pct = limitW > 0 ? (watts / limitW) * 100 : 0;
  return (
    <section className="h-full rounded-lg border border-line bg-surface p-6">
      <p className="text-[15px] text-fg-2">Total daya sekarang</p>
      <p className="mt-3 flex items-baseline gap-2">
        <span className="text-[40px] leading-none font-semibold text-fg tabular-nums">{fmtSmart(watts, 0)}</span>
        <span className="text-base text-fg-3">W</span>
      </p>
      <div
        role="progressbar"
        aria-label="Beban terhadap batas panel"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(100, pct))}
        className="mt-5 h-1.5 overflow-hidden rounded-full bg-primary-soft"
      >
        <div
          className={cn("h-full rounded-full", pct >= 100 ? "bg-danger-solid" : pct >= 80 ? "bg-warning-line" : "bg-primary-solid")}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <p className="mt-2.5 text-[13px] text-fg-2">
        {fmtNum(pct, 0)}% dari batas panel {fmtNum(limitW, 0)} W
      </p>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-5">
        <Metric label="Puncak hari ini" value={peak ? `${fmtSmart(peak.w, 0)} W` : "—"} sub={peak ? fmtHM(peak.ts) : undefined} />
        <Metric label="Rata-rata 1 jam" value={avg1h != null ? `${fmtSmart(avg1h, 0)} W` : "—"} />
        <Metric label="Jalur aktif" value={`${active} dari ${total}`} />
        <Metric label="Tegangan rata-rata" value={avgVoltage != null ? `${fmtNum(avgVoltage, 1)} V` : "—"} />
      </dl>
    </section>
  );
}
