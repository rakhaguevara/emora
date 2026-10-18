"use client";

import { Lightbulb } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader, PageSkeleton } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { energyRows, type EnergyRow } from "@/lib/analytics";
import { niceDomain } from "@/lib/chart";
import { cn } from "@/lib/cn";
import { PF_TARGET } from "@/lib/constants";
import { currentTariff, tipsForDay } from "@/lib/energyInfo";
import { fmtDay, fmtDayLong, fmtEnergyText, fmtHM, fmtNum, fmtRp, ymd } from "@/lib/format";
import { computeOverview } from "@/lib/overview";
import { energyKwhBetween } from "@/lib/sim/engine";
import { isLive, useApp, useLive } from "@/lib/store";
import { costRp, effectivePerKwh, type Tariff } from "@/lib/tariff";
import type { AppState } from "@/lib/types";
import { seriesDefs, type SeriesDef } from "./seriesColors";

const RANGES = [
  { days: 1, label: "Hari ini" },
  { days: 3, label: "3 hari" },
  { days: 7, label: "7 hari" },
  { days: 30, label: "30 hari" },
] as const;
const DEFAULT_DAYS = 7;
const DAY = 86400e3;
const AXIS = { fill: "var(--fg-3)", fontSize: 11 };

function Legend({ defs }: { defs: SeriesDef[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-2">
      {defs.map((d) => (
        <li key={d.key} className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
          {d.label}
        </li>
      ))}
    </ul>
  );
}

function TipBox({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-44 rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-[var(--shadow)]">
      <div className="mb-1.5 text-fg-3">{label}</div>
      {children}
    </div>
  );
}

function TipRow({ color, label, value, bold }: { color?: string; label: string; value: string; bold?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-4 py-0.5", bold && "mt-1 border-t border-line pt-1.5 font-semibold text-fg")}>
      <span className="inline-flex items-center gap-2 text-fg-2">
        {color && <span className="h-0.5 w-3 rounded" style={{ background: color }} />}
        {label}
      </span>
      <span className="font-semibold text-fg tabular-nums">{value}</span>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div>
      <dt className="text-[13px] text-fg-3">{label}</dt>
      <dd className={cn("mt-1 text-[15px] font-bold tabular-nums", tone === "good" ? "text-success" : tone === "bad" ? "text-danger" : "text-fg")}>
        {value}
      </dd>
      {sub && <dd className="mt-0.5 text-xs text-fg-3">{sub}</dd>}
    </div>
  );
}

// Energi periode pembanding: rentang yang sama persis, digeser mundur sepanjang rentang.
function previousKwh(app: AppState, start: number, now: number, days: number): number {
  const span = days * DAY;
  return app.jalur.reduce((s, j) => s + energyKwhBetween(app, j, start - span, now - span), 0);
}

function CostCard({ tariff, totalKwh, prevKwh, days, elapsedDays, projectionKwh, rows }: {
  tariff: Tariff; totalKwh: number; prevKwh: number; days: number; elapsedDays: number; projectionKwh: number; rows: EnergyRow[];
}) {
  const perDayKwh = elapsedDays > 0 ? totalKwh / elapsedDays : 0;
  const diffKwh = totalKwh - prevKwh;
  const diffPct = prevKwh > 0 ? (diffKwh / prevKwh) * 100 : null;
  const covered = rows.filter((r) => r.hasData).length;
  const prevLabel = days === 1 ? "kemarin di jam yang sama" : `${days} hari sebelumnya`;

  return (
    <Card>
      <CardHeader title="Biaya listrik" subtitle={days === 1 ? "Hari ini sampai sekarang" : `${days} hari terakhir`} />
      <div className="px-5 pt-4">
        <p className="text-[30px] leading-none font-semibold text-fg tabular-nums">{fmtRp(costRp(totalKwh, tariff))}</p>
        <p className="mt-1.5 text-[13px] text-fg-3">{fmtEnergyText(totalKwh)} terpakai</p>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-line px-5 py-5">
        <Stat
          label={`vs ${prevLabel}`}
          value={diffPct == null ? "—" : `${diffKwh > 0 ? "+" : "−"}${fmtNum(Math.abs(diffPct), 1)}%`}
          sub={diffPct == null ? "Belum ada data pembanding" : `${diffKwh > 0 ? "Lebih boros" : "Lebih hemat"} ${fmtRp(Math.abs(costRp(diffKwh, tariff)))}`}
          tone={diffPct == null ? undefined : diffKwh <= 0 ? "good" : "bad"}
        />
        <Stat label="Rata-rata per hari" value={fmtRp(costRp(perDayKwh, tariff))} sub={fmtEnergyText(perDayKwh)} />
        <Stat label="Proyeksi bulan ini" value={fmtRp(costRp(projectionKwh, tariff))} sub={fmtEnergyText(projectionKwh)} />
        <Stat label="Tarif efektif" value={`${fmtRp(effectivePerKwh(tariff))}/kWh`} sub={tariff.taxPct ? `Termasuk pajak ${fmtNum(tariff.taxPct, 1)}%` : "Tanpa pajak"} />
      </dl>
      <div className="border-t border-line px-5 py-3 text-xs text-fg-3">
        <p>
          Golongan {tariff.cls} · Rp {fmtNum(tariff.perKwh, 2)}/kWh{isLive ? " · diatur admin" : " · tarif contoh (mode demo)"}
        </p>
        {isLive && days > 1 && covered < rows.length && (
          <p className="mt-1">Data tersedia {covered} dari {rows.length} hari. Hari tanpa data dihitung 0 kWh.</p>
        )}
      </div>
    </Card>
  );
}

function TipsCard({ day, tariff }: { day: number; tariff: Tariff }) {
  const tips = tipsForDay(ymd(day));
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-medium text-primary">
            <Lightbulb className="h-[18px] w-[18px]" /> Rekomendasi hari ini
          </h2>
          <p className="mt-1 text-[13px] text-fg-3">{fmtDayLong(day)} · dari admin</p>
        </div>
        {tips.length > 0 && <Badge tone="primary">{tips.length}</Badge>}
      </div>
      {tips.length === 0 ? (
        <p className="mt-4 border-t border-line px-5 py-8 text-center text-[13px] text-fg-3">
          {isLive ? "Admin belum menambahkan rekomendasi untuk hari ini." : "Rekomendasi harian diisi admin dan tampil di mode live."}
        </p>
      ) : (
        <ul className="mt-4 border-t border-line">
          {tips.map((t) => (
            <li key={t.id} className="border-b border-line px-5 py-4 last:border-b-0">
              <p className="font-bold text-fg">{t.title}</p>
              {t.body && <p className="mt-1 text-[13px] whitespace-pre-line text-fg-2">{t.body}</p>}
              {t.savingKwhPerDay != null && t.savingKwhPerDay > 0 && (
                <p className="mt-2 text-[13px] font-bold text-success">
                  Potensi hemat ± {fmtEnergyText(t.savingKwhPerDay)}/hari · ± {fmtRp(costRp(t.savingKwhPerDay * 30, tariff))}/bulan
                </p>
              )}
              <p className="mt-2 text-xs text-fg-3">Oleh {t.createdBy}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function EnergiView() {
  const app = useApp();
  const live = useLive();
  const [pfJalur, setPfJalur] = useState("all");
  const [days, setDays] = useState<number>(DEFAULT_DAYS);

  const minute = live ? Math.floor(live.now / 60e3) : 0;
  const now = live?.now ?? 0;

  const computed = useMemo(() => {
    if (!app || !now) return null;
    const rows = energyRows(app, app.jalur, now, days);
    const start = days === 1 ? rows[0].ts : rows[0].ts;
    return {
      rows,
      start,
      prevKwh: previousKwh(app, start, now, days),
      projectionKwh: computeOverview(app, now).monthProjectionKwh,
    };
    // Dihitung ulang tiap menit atau saat data aplikasi berubah (termasuk ringkasan energi baru).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, minute, days]);

  if (!app || !live || !computed) return <PageSkeleton />;

  const { rows, start, prevKwh, projectionKwh } = computed;
  const tariff = currentTariff();
  const hourly = days === 1;
  const defs = seriesDefs(app.jalur);
  const perJalurTotal = app.jalur.map((j) => ({ j, kwh: rows.reduce((s, d) => s + (d.perJalur[j.id] ?? 0), 0) }));
  const totalKwh = perJalurTotal.reduce((s, x) => s + x.kwh, 0);
  const ranked = [...perJalurTotal].sort((a, b) => b.kwh - a.kwh);
  const elapsedDays = Math.max((now - start) / DAY, 1 / 24);
  const th = app.jalur[0]?.thresholds;

  const label = (ts: number) => (hourly ? fmtHM(ts) : fmtDay(ts));
  // Per jam: label tiap 3 jam; 1–7 hari: tiap hari; 30 hari: jarang agar tidak bertabrakan di layar kecil.
  const xInterval = hourly ? 2 : days <= 7 ? 0 : 4;
  const future = (ts: number) => ts > now;

  const barData = rows.map((d) => {
    const row: Record<string, number | string | null> = { ts: d.ts, label: label(d.ts) };
    for (const s of defs) row[s.key] = future(d.ts) ? null : s.jalurIds.reduce((sum, id) => sum + (d.perJalur[id] ?? 0), 0);
    return row;
  });
  const maxBar = Math.max(0.001, ...rows.map((d) => d.total));
  const barScale = niceDomain(0, maxBar * 1.05, 4);
  const barUnit = maxBar < 1 ? "Wh" : "kWh";
  const barFactor = barUnit === "Wh" ? 1000 : 1;

  const vData = rows.map((d) => ({
    ts: d.ts, label: label(d.ts), avg: d.vAvg, range: d.vMin != null && d.vMax != null ? [d.vMin, d.vMax] : null, min: d.vMin, max: d.vMax,
  }));
  const vSeen = rows.flatMap((d) => [d.vMin, d.vMax]).filter((v): v is number => v != null);
  const vScale = niceDomain(
    Math.min(...vSeen, th?.voltMin ?? 200) - 5,
    Math.max(...vSeen, th?.voltMax ?? 240) + 5,
    4,
  );
  const vWith = rows.filter((d) => d.vAvg != null);
  const vAvgAll = vWith.length ? vWith.reduce((s, d) => s + d.vAvg!, 0) / vWith.length : null;
  const vMinAll = vSeen.length ? Math.min(...vSeen) : null;
  const vMaxAll = vSeen.length ? Math.max(...vSeen) : null;

  const pfDefs = pfJalur === "all" ? defs.filter((d) => d.key !== "other") : defs.filter((d) => d.key === pfJalur);
  const pfData = rows.map((d) => {
    const row: Record<string, number | string | null> = { ts: d.ts, label: label(d.ts) };
    for (const s of pfDefs) row[s.key] = d.pfPerJalur[s.key] ?? null;
    return row;
  });

  const end = Math.min(rows[rows.length - 1].ts, now);
  const period = hourly ? fmtDayLong(start) : `${fmtDay(start)}–${fmtDayLong(end)}`;
  const bucketWord = hourly ? "per jam" : "harian";

  return (
    <>
      <PageHeader
        title="Energi & Efisiensi"
        subtitle={`${hourly ? "Hari ini, per jam" : `Analisis ${days} hari`} · ${period}`}
        actions={
          <div className="sm:text-right">
            <p className="text-xs text-fg-3">Total biaya</p>
            <p className="text-[26px] leading-tight font-semibold text-fg">{fmtRp(costRp(totalKwh, tariff))}</p>
          </div>
        }
      />

      <div role="group" aria-label="Rentang analisis" className="mb-5 grid grid-cols-4 overflow-hidden rounded-md border border-line-strong sm:inline-grid sm:w-auto">
        {RANGES.map((r) => (
          <button
            key={r.days}
            type="button"
            aria-pressed={days === r.days}
            onClick={() => setDays(r.days)}
            className={cn(
              "h-10 border-r border-line-strong px-2 text-sm whitespace-nowrap last:border-r-0 sm:px-5",
              days === r.days ? "bg-primary-soft font-semibold text-primary" : "bg-surface text-fg-2 hover:bg-surface-2",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-5">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div>
                <h2 className="text-lg font-medium text-fg">Konsumsi energi {bucketWord}</h2>
                <p className="mt-1 text-[13px] text-fg-3">
                  {barUnit} {app.jalur.length > 1 ? "per jalur" : ""}{isLive ? " · dari counter energi PZEM" : ""}
                </p>
              </div>
              <p className="text-lg font-semibold whitespace-nowrap text-fg tabular-nums">{fmtEnergyText(totalKwh)}</p>
            </div>
            <div role="img" aria-label={`Grafik batang konsumsi energi ${bucketWord}`} className="mt-4 h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
                  <CartesianGrid stroke="var(--grid)" vertical={false} />
                  <XAxis dataKey="label" interval={xInterval} tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--axis)" }} tickMargin={10} />
                  <YAxis
                    domain={barScale.domain} ticks={barScale.ticks} width={44} tick={AXIS} tickLine={false} axisLine={false}
                    tickFormatter={(v: number) => fmtNum(v * barFactor, barUnit === "Wh" ? 0 : v < 10 ? 1 : 0)}
                  />
                  <Tooltip
                    isAnimationActive={false}
                    cursor={{ fill: "var(--surface-2)" }}
                    content={({ active, label: l, payload }) => {
                      if (!active) return null;
                      const row = payload?.[0]?.payload as Record<string, number | null> | undefined;
                      if (!row || row[defs[0]?.key] == null) return null;
                      const total = defs.reduce((s, d) => s + (row[d.key] ?? 0), 0);
                      return (
                        <TipBox label={String(l ?? "")}>
                          {defs.length > 1 && [...defs].reverse().map((d) => (
                            <TipRow key={d.key} color={d.color} label={d.label} value={fmtEnergyText(row[d.key] ?? 0)} />
                          ))}
                          <TipRow label="Energi" value={fmtEnergyText(total)} bold={defs.length > 1} />
                          <TipRow label="Biaya" value={fmtRp(costRp(total, tariff))} />
                        </TipBox>
                      );
                    }}
                  />
                  {defs.map((d, i) => (
                    <Bar
                      key={d.key} dataKey={d.key} stackId="kwh" fill={d.color}
                      stroke="var(--surface)" strokeWidth={2} maxBarSize={hourly ? 18 : days <= 3 ? 48 : 22} isAnimationActive={false}
                      radius={i === defs.length - 1 ? [4, 4, 0, 0] : 0}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            {defs.length > 1 && <div className="mt-3 border-t border-line pt-3"><Legend defs={defs} /></div>}
            <table className="sr-only-table">
              <caption>Konsumsi energi {bucketWord} (kWh) dan biaya</caption>
              <thead><tr><th>Waktu</th>{defs.map((d) => <th key={d.key}>{d.label}</th>)}<th>Biaya</th></tr></thead>
              <tbody>
                {rows.filter((r) => !future(r.ts)).map((r) => (
                  <tr key={r.ts}>
                    <td>{label(r.ts)}</td>
                    {defs.map((d) => <td key={d.key}>{fmtNum(d.jalurIds.reduce((s, id) => s + (r.perJalur[id] ?? 0), 0), 3)}</td>)}
                    <td>{fmtRp(costRp(r.total, tariff))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div>
                <h2 className="text-lg font-medium text-fg">Tegangan {bucketWord}</h2>
                <p className="mt-1 text-[13px] text-fg-3">
                  Rata-rata dan rentang terendah–tertinggi{th ? ` · batas ${fmtNum(th.voltMin, 0)}–${fmtNum(th.voltMax, 0)} V` : ""}
                </p>
              </div>
              <p className="text-lg font-semibold whitespace-nowrap text-fg tabular-nums">{vAvgAll == null ? "—" : `${fmtNum(vAvgAll, 1)} V`}</p>
            </div>
            {vSeen.length === 0 ? (
              <p className="py-16 text-center text-[13px] text-fg-3">Belum ada data tegangan pada rentang ini.</p>
            ) : (
              <div role="img" aria-label={`Grafik tegangan ${bucketWord}`} className="mt-4 h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={vData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="label" interval={xInterval} tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--axis)" }} tickMargin={10} />
                    <YAxis domain={vScale.domain} ticks={vScale.ticks} width={44} tick={AXIS} tickLine={false} axisLine={false} />
                    {th && <ReferenceLine y={th.voltMin} stroke="var(--danger)" strokeDasharray="5 4" strokeWidth={1.25} />}
                    {th && <ReferenceLine y={th.voltMax} stroke="var(--danger)" strokeDasharray="5 4" strokeWidth={1.25} />}
                    <Tooltip
                      isAnimationActive={false}
                      cursor={{ stroke: "var(--fg-3)" }}
                      content={({ active, label: l, payload }) => {
                        if (!active) return null;
                        const r = payload?.[0]?.payload as { avg: number | null; min: number | null; max: number | null } | undefined;
                        if (!r || r.avg == null) return null;
                        return (
                          <TipBox label={String(l ?? "")}>
                            <TipRow color="var(--chart-line)" label="Rata-rata" value={`${fmtNum(r.avg, 1)} V`} />
                            <TipRow label="Terendah" value={`${fmtNum(r.min!, 1)} V`} />
                            <TipRow label="Tertinggi" value={`${fmtNum(r.max!, 1)} V`} />
                          </TipBox>
                        );
                      }}
                    />
                    <Area dataKey="range" stroke="none" fill="var(--primary-soft)" isAnimationActive={false} connectNulls={false} />
                    <Line dataKey="avg" stroke="var(--chart-line)" strokeWidth={2} dot={vWith.length < 3} isAnimationActive={false} connectNulls={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
            <dl className="mt-3 grid grid-cols-3 gap-4 border-t border-line pt-3">
              <Stat label="Terendah" value={vMinAll == null ? "—" : `${fmtNum(vMinAll, 1)} V`} tone={th && vMinAll != null && vMinAll < th.voltMin ? "bad" : undefined} />
              <Stat label="Rata-rata" value={vAvgAll == null ? "—" : `${fmtNum(vAvgAll, 1)} V`} />
              <Stat label="Tertinggi" value={vMaxAll == null ? "—" : `${fmtNum(vMaxAll, 1)} V`} tone={th && vMaxAll != null && vMaxAll > th.voltMax ? "bad" : undefined} />
            </dl>
            <table className="sr-only-table">
              <caption>Tegangan {bucketWord}: rata-rata, terendah, tertinggi (V)</caption>
              <thead><tr><th>Waktu</th><th>Rata-rata</th><th>Terendah</th><th>Tertinggi</th></tr></thead>
              <tbody>
                {vWith.map((r) => (
                  <tr key={r.ts}><td>{label(r.ts)}</td><td>{fmtNum(r.vAvg!, 1)}</td><td>{fmtNum(r.vMin!, 1)}</td><td>{fmtNum(r.vMax!, 1)}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium text-fg">Faktor daya {bucketWord}</h2>
                <p className="mt-1 text-[13px] text-fg-3">Rata-rata saat ada beban · target {fmtNum(PF_TARGET, 2)}</p>
              </div>
              {app.jalur.length > 1 && (
                <Select aria-label="Pilih jalur" value={pfJalur} onChange={(e) => setPfJalur(e.target.value)} className="w-full sm:w-44">
                  <option value="all">Semua jalur</option>
                  {app.jalur.filter((j) => j.number <= 5).map((j) => (
                    <option key={j.id} value={j.id}>Jalur {j.number} · {j.name}</option>
                  ))}
                </Select>
              )}
            </div>
            {pfData.every((r) => pfDefs.every((d) => r[d.key] == null)) ? (
              <p className="py-16 text-center text-[13px] text-fg-3">Belum ada data faktor daya (tidak ada beban terukur) pada rentang ini.</p>
            ) : (
              <div role="img" aria-label={`Grafik garis rata-rata faktor daya ${bucketWord}`} className="mt-4 h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={pfData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--grid)" vertical={false} />
                    <XAxis dataKey="label" interval={xInterval} tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--axis)" }} tickMargin={10} />
                    <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} width={44} tickFormatter={(v: number) => fmtNum(v, 2)} tick={AXIS} tickLine={false} axisLine={false} />
                    <ReferenceLine y={PF_TARGET} stroke="var(--fg-3)" strokeDasharray="5 4" strokeWidth={1.25} />
                    <Tooltip
                      isAnimationActive={false}
                      cursor={{ stroke: "var(--fg-3)" }}
                      content={({ active, label: l, payload }) => {
                        if (!active) return null;
                        const row = payload?.[0]?.payload as Record<string, number | null> | undefined;
                        return (
                          <TipBox label={String(l ?? "")}>
                            {pfDefs.map((d) => (
                              <TipRow key={d.key} color={d.color} label={d.label} value={row?.[d.key] == null ? "—" : fmtNum(row[d.key]!, 2)} />
                            ))}
                          </TipBox>
                        );
                      }}
                    />
                    {pfDefs.map((d) => (
                      <Line key={d.key} type="monotone" dataKey={d.key} stroke={d.color} strokeWidth={2} dot={false}
                        activeDot={{ r: 4, fill: d.color, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-3">
              {pfDefs.length > 1 && <Legend defs={pfDefs} />}
              <span className="inline-flex items-center gap-2 text-xs text-fg-2">
                <svg width="20" height="2" aria-hidden><line x1="0" y1="1" x2="20" y2="1" stroke="var(--fg-3)" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
                Target {fmtNum(PF_TARGET, 2)}. Di bawah target berarti daya reaktif tinggi (motor, kompresor, lampu non-PFC).
              </span>
            </div>
            <table className="sr-only-table">
              <caption>Rata-rata faktor daya {bucketWord}</caption>
              <thead><tr><th>Waktu</th>{pfDefs.map((d) => <th key={d.key}>{d.label}</th>)}</tr></thead>
              <tbody>{pfData.map((r) => <tr key={String(r.ts)}><td>{r.label}</td>{pfDefs.map((d) => <td key={d.key}>{r[d.key] == null ? "—" : fmtNum(Number(r[d.key]), 2)}</td>)}</tr>)}</tbody>
            </table>
          </Card>
        </div>

        <div className="space-y-5">
          <CostCard
            tariff={tariff} totalKwh={totalKwh} prevKwh={prevKwh} days={days}
            elapsedDays={elapsedDays} projectionKwh={projectionKwh} rows={rows.filter((r) => !future(r.ts))}
          />
          <TipsCard day={now} tariff={tariff} />
          {ranked.length > 1 && (
            <Card>
              <CardHeader title="Porsi energi per jalur" className="pb-3" />
              <ol className="px-5 pb-3">
                {ranked.map(({ j, kwh }, i) => {
                  const pct = totalKwh ? (kwh / totalKwh) * 100 : 0;
                  return (
                    <li key={j.id} className="border-b border-line py-4 first:pt-3 last:border-b-0">
                      <div className="flex items-center gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary">{i + 1}</span>
                        <span className="flex-1 truncate text-[13px] text-fg">Jalur {j.number} · {j.name}</span>
                        <span className="text-[15px] font-bold text-fg tabular-nums">{fmtNum(pct, 0)}%</span>
                      </div>
                      <div className="mt-2 flex items-center gap-3 pl-9">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-primary-soft">
                          <div className="h-full rounded-full bg-primary-solid" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-28 text-right text-xs text-fg-3 tabular-nums">{fmtEnergyText(kwh)} · {fmtRp(costRp(kwh, tariff))}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
