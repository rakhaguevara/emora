import { cn } from "@/lib/cn";
import { TARIFF_PER_KWH } from "@/lib/constants";
import { fmtNum, fmtRp, fmtRpShort, fmtEnergy } from "@/lib/format";

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div>
      <dt className="text-[13px] text-fg-3">{label}</dt>
      <dd className={cn("mt-1 text-[15px] font-bold tabular-nums", tone === "good" ? "text-success" : tone === "bad" ? "text-danger" : "text-fg")}>
        {value}
      </dd>
    </div>
  );
}

export function EnergyCard({
  kwh, vsYesterdayPct, projectionKwh, pf, biggest,
}: {
  kwh: number;
  vsYesterdayPct: number | null; // negatif = lebih hemat dari kemarin
  projectionKwh: number;
  pf: number | null;
  biggest: { label: string; sharePct: number } | null;
}) {
  const sign = vsYesterdayPct == null ? "" : vsYesterdayPct > 0 ? "+" : "−";
  return (
    <section className="h-full rounded-lg border border-line bg-surface p-6">
      <div className="flex">
        <div className="pr-5">
          <p className="text-[15px] text-fg-2">Energi hari ini</p>
          <p className="mt-3 flex items-baseline gap-1.5">
            <span className="text-[26px] leading-none font-semibold text-fg tabular-nums">{fmtEnergy(kwh).value}</span>
            <span className="text-[13px] text-fg-3">{fmtEnergy(kwh).unit}</span>
          </p>
        </div>
        <div className="min-w-0 flex-1 border-l border-line pl-5">
          <p className="text-[15px] text-fg-2">Estimasi biaya</p>
          <p className="mt-3 text-[26px] leading-none font-semibold whitespace-nowrap text-fg tabular-nums">{fmtRp(kwh * TARIFF_PER_KWH)}</p>
          <p className="mt-1.5 text-xs whitespace-nowrap text-fg-3">Tarif Rp {fmtNum(TARIFF_PER_KWH, 0)}/kWh</p>
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-5">
        <Metric
          label="vs kemarin"
          value={vsYesterdayPct == null ? "—" : `${sign}${fmtNum(Math.abs(vsYesterdayPct), 1)}%`}
          tone={vsYesterdayPct == null ? undefined : vsYesterdayPct <= 0 ? "good" : "bad"}
        />
        <Metric label="Proyeksi bulan ini" value={fmtRpShort(projectionKwh * TARIFF_PER_KWH)} />
        <Metric label="PF rata-rata" value={pf != null ? fmtNum(pf, 2) : "—"} />
        <Metric label="Beban terbesar" value={biggest ? `${biggest.label} · ${fmtNum(biggest.sharePct, 0)}%` : "—"} />
      </dl>
    </section>
  );
}
