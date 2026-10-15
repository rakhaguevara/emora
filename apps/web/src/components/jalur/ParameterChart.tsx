"use client";

import { useMemo } from "react";
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { FREQ_MAX, FREQ_MIN, PARAM_META } from "@/lib/constants";
import { formatTick, niceDomain, RANGE_META, timeTicks, type RangeKey } from "@/lib/chart";
import { fmtDay, fmtHM, fmtNum } from "@/lib/format";
import { series, type Point } from "@/lib/sim/engine";
import type { AppState, Jalur, Param } from "@/lib/types";

interface Limit {
  value: number;
  label: string;
}

function limitsFor(j: Jalur, param: Param): Limit[] {
  const t = j.thresholds;
  const m = PARAM_META[param];
  const f = (n: number) => `${fmtNum(n, m.digits)} ${m.unit === "PF" ? "" : m.unit}`.trim();
  switch (param) {
    case "voltage": return [{ value: t.voltMin, label: `Batas min. ${f(t.voltMin)}` }, { value: t.voltMax, label: `Batas maks. ${f(t.voltMax)}` }];
    case "current": return [{ value: t.currentMax, label: `Batas ${f(t.currentMax)}` }];
    case "power": return [{ value: t.powerMax, label: `Batas ${f(t.powerMax)}` }];
    case "pf": return [{ value: t.pfMin, label: `Batas min. ${f(t.pfMin)}` }];
    case "frequency": return [{ value: FREQ_MIN, label: `Batas ${fmtNum(FREQ_MIN, 1)} Hz` }, { value: FREQ_MAX, label: `Batas ${fmtNum(FREQ_MAX, 1)} Hz` }];
  }
}

export function chartLimits(j: Jalur, param: Param) {
  return limitsFor(j, param);
}

function TripLabel({ viewBox, text }: { viewBox?: { x: number; y: number }; text: string }) {
  if (!viewBox) return null;
  const w = text.length * 6.4 + 14;
  return (
    <g>
      <rect x={viewBox.x - w - 6} y={viewBox.y + 6} width={w} height={18} rx={3} fill="var(--danger-soft)" />
      <text x={viewBox.x - 13} y={viewBox.y + 19} textAnchor="end" fontSize={11} fontWeight={500} fill="var(--danger)">
        {text}
      </text>
    </g>
  );
}

function ChartTooltip({ active, payload, param }: { active?: boolean; payload?: { payload: Point }[]; param: Param }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const m = PARAM_META[param];
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-[var(--shadow)]">
      <div className="text-fg-3">{fmtDay(p.ts)}, {fmtHM(p.ts)}</div>
      <div className="mt-0.5 text-sm font-semibold text-fg">
        {p.value == null ? "Tidak ada data" : `${fmtNum(p.value, m.digits)} ${m.unit}`}
      </div>
    </div>
  );
}

export function ParameterChart({
  app, jalur, param, range, now,
}: {
  app: AppState;
  jalur: Jalur;
  param: Param;
  range: RangeKey;
  now: number;
}) {
  const meta = RANGE_META[range];
  const minute = Math.floor(now / 60e3);
  const to = minute * 60e3;
  const from = to - meta.spanMs;
  const offLog = app.offLog[jalur.id];

  // Dihitung ulang per menit, bukan per detik, agar grafik tidak digambar ulang terus.
  const data = useMemo(
    () => series(app, jalur, param, from, to, meta.stepMs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app.anomalies, app.seededAt, offLog, jalur.number, jalur.id, jalur.offlineSince, param, from, to, meta.stepMs],
  );

  const limits = limitsFor(jalur, param);
  const trips = app.events.filter((e) => e.jalurId === jalur.id && e.type === "trip" && e.startedAt >= from && e.startedAt <= to);

  const values = data.map((d) => d.value).filter((v): v is number => v != null);
  const lo = Math.min(...values, ...limits.map((l) => l.value));
  const hi = Math.max(...values, ...limits.map((l) => l.value));
  const scale =
    param === "pf" ? niceDomain(Math.min(0.6, Math.floor(lo * 20) / 20), 1, 4)
    : param === "voltage" || param === "frequency" ? niceDomain(lo - (hi - lo) * 0.25 - 0.1, hi + (hi - lo) * 0.25 + 0.1, 4)
    : niceDomain(0, (values.length ? hi : 1) * 1.1, 4);
  const ticks = timeTicks(from, to, meta.tickMs);
  const m = PARAM_META[param];

  const tableRows = data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 48)) === 0);

  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-fg-2">
        <span className="inline-flex items-center gap-2">
          <span className="h-0.5 w-5 rounded bg-[var(--chart-line)]" /> {m.label}
        </span>
        {limits.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-2">
            <svg width="20" height="2" aria-hidden><line x1="0" y1="1" x2="20" y2="1" stroke="var(--fg-3)" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
            {l.label}
          </span>
        ))}
        {trips.length > 0 && (
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-0.5 bg-danger-solid" /> Kejadian trip
          </span>
        )}
      </div>

      <div role="img" aria-label={`Grafik ${m.label} ${jalur.name}, ${meta.label}`} className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" vertical={false} />
            <XAxis
              dataKey="ts" type="number" scale="time" domain={[from, to]} ticks={ticks}
              tickFormatter={(v: number) => formatTick(v, range)}
              tick={{ fill: "var(--fg-3)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--axis)" }} tickMargin={10}
            />
            <YAxis
              domain={scale.domain} ticks={scale.ticks} width={52}
              tickFormatter={(v: number) => `${fmtNum(v, param === "pf" ? 2 : param === "frequency" ? 1 : 0)}${param === "pf" ? "" : " " + m.unit}`}
              tick={{ fill: "var(--fg-3)", fontSize: 11 }} tickLine={false} axisLine={false}
            />
            {limits.map((l) => (
              <ReferenceLine key={l.label} y={l.value} stroke="var(--fg-3)" strokeDasharray="5 4" strokeWidth={1.25} ifOverflow="extendDomain" />
            ))}
            {trips.map((t) => (
              <ReferenceLine
                key={t.id} x={t.startedAt} stroke="var(--danger-solid)" strokeWidth={1.5}
                label={<TripLabel text={`Trip ${range === "1h" || range === "24h" ? fmtHM(t.startedAt) : fmtDay(t.startedAt)}`} />}
              />
            ))}
            <Tooltip content={<ChartTooltip param={param} />} cursor={{ stroke: "var(--fg-3)", strokeWidth: 1 }} isAnimationActive={false} />
            <Line
              type="linear" dataKey="value" stroke="var(--chart-line)" strokeWidth={2} dot={false}
              activeDot={{ r: 4, fill: "var(--chart-line)", stroke: "var(--surface)", strokeWidth: 2 }}
              isAnimationActive={false} connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <table className="sr-only-table">
        <caption>{`${m.label} ${jalur.name}, ${meta.label}`}</caption>
        <thead><tr><th>Waktu</th><th>{m.label} ({m.unit})</th></tr></thead>
        <tbody>
          {tableRows.map((d) => (
            <tr key={d.ts}><td>{fmtDay(d.ts)} {fmtHM(d.ts)}</td><td>{d.value == null ? "tidak ada data" : fmtNum(d.value, m.digits)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
