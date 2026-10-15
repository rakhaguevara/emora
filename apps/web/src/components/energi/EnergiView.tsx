"use client";

import { Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader, PageSkeleton } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { dailyEnergy, dailyPf, recommendations, savingText } from "@/lib/analytics";
import { niceDomain } from "@/lib/chart";
import { PF_TARGET, TARIFF_PER_KWH } from "@/lib/constants";
import { fmtDay, fmtDayLong, fmtNum, fmtRp } from "@/lib/format";
import { actions, useApp, useLive } from "@/lib/store";
import { seriesDefs, type SeriesDef } from "./seriesColors";

const DAYS = 30;
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

type TipRow = { key: string; label: string; color: string; value: number | null };

function Tip({ active, label, rows, total, unit, digits }: { active?: boolean; label?: string; rows: TipRow[]; total?: number; unit: string; digits: number }) {
  if (!active) return null;
  return (
    <div className="min-w-40 rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-[var(--shadow)]">
      <div className="mb-1.5 text-fg-3">{label}</div>
      {rows.map((r) => (
        <div key={r.key} className="flex items-center justify-between gap-4 py-0.5">
          <span className="inline-flex items-center gap-2 text-fg-2">
            <span className="h-0.5 w-3 rounded" style={{ background: r.color }} />
            {r.label}
          </span>
          <span className="font-semibold text-fg tabular-nums">{r.value == null ? "—" : `${fmtNum(r.value, digits)} ${unit}`.trim()}</span>
        </div>
      ))}
      {total != null && (
        <div className="mt-1 flex justify-between border-t border-line pt-1.5 font-semibold text-fg">
          <span>Total</span>
          <span className="tabular-nums">{fmtNum(total, digits)} {unit}</span>
        </div>
      )}
    </div>
  );
}

export function EnergiView() {
  const app = useApp();
  const live = useLive();
  const router = useRouter();
  const [pfJalur, setPfJalur] = useState("all");

  const minute = live ? Math.floor(live.now / 60e3) : 0;
  const now = minute * 60e3;

  const computed = useMemo(() => {
    if (!app) return null;
    return {
      daily: dailyEnergy(app, app.jalur, now, DAYS),
      pf: dailyPf(app, app.jalur, now, DAYS),
      recs: recommendations(app, app.jalur, now),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?.anomalies, app?.offLog, app?.jalur, app?.seededAt, minute]);

  if (!app || !live || !computed) return <PageSkeleton />;

  const { daily, pf, recs } = computed;
  const defs = seriesDefs(app.jalur);
  const perJalurTotal = app.jalur.map((j) => ({ j, kwh: daily.reduce((s, d) => s + (d.perJalur[j.id] ?? 0), 0) }));
  const totalKwh = perJalurTotal.reduce((s, x) => s + x.kwh, 0);
  const ranked = [...perJalurTotal].sort((a, b) => b.kwh - a.kwh);

  const barData = daily.map((d) => {
    const row: Record<string, number | string> = { ts: d.ts, label: fmtDay(d.ts) };
    for (const s of defs) row[s.key] = s.jalurIds.reduce((sum, id) => sum + (d.perJalur[id] ?? 0), 0);
    return row;
  });
  const maxDay = Math.max(1, ...daily.map((d) => d.total));
  const barScale = niceDomain(0, maxDay * 1.05, 4);

  const pfDefs = pfJalur === "all" ? defs.filter((d) => d.key !== "other") : defs.filter((d) => d.key === pfJalur);
  const pfData = pf.map((d) => {
    const row: Record<string, number | string | null> = { ts: d.ts, label: fmtDay(d.ts) };
    for (const s of pfDefs) row[s.key] = d.perJalur[s.key] ?? null;
    return row;
  });

  const visibleRecs = recs.filter((r) => !app.dismissedRecs.includes(r.id));
  const start = daily[0].ts;
  const end = daily[daily.length - 1].ts;
  const period = `${fmtDay(start)}–${fmtDayLong(end)}`;

  return (
    <>
      <PageHeader
        title="Energi & Efisiensi"
        subtitle={`Analisis ${DAYS} hari · ${period}`}
        actions={
          <div className="sm:text-right">
            <p className="text-xs text-fg-3">Total biaya</p>
            <p className="text-[26px] leading-tight font-semibold text-fg">{fmtRp(totalKwh * TARIFF_PER_KWH)}</p>
          </div>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="relative p-5">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <div>
              <h2 className="text-lg font-medium text-fg">Konsumsi energi harian</h2>
              <p className="mt-1 text-[13px] text-fg-3">kWh per jalur</p>
            </div>
            <p className="text-lg font-semibold whitespace-nowrap text-fg tabular-nums">{fmtNum(totalKwh, 1)} kWh</p>
          </div>
          <div role="img" aria-label="Grafik batang konsumsi energi harian per jalur" className="mt-4 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="label" interval={4} tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--axis)" }} tickMargin={10} />
                <YAxis domain={barScale.domain} ticks={barScale.ticks} width={40} tick={AXIS} tickLine={false} axisLine={false} />
                <Tooltip
                  isAnimationActive={false}
                  cursor={{ fill: "var(--surface-2)" }}
                  content={({ active, label, payload }) => {
                    const row = payload?.[0]?.payload as Record<string, number> | undefined;
                    const total = row ? defs.reduce((s, d) => s + (row[d.key] ?? 0), 0) : 0;
                    return (
                      <Tip
                        active={active} label={String(label ?? "")} unit="kWh" digits={1} total={total}
                        rows={[...defs].reverse().map((d) => ({ key: d.key, label: d.label, color: d.color, value: row?.[d.key] ?? null }))}
                      />
                    );
                  }}
                />
                {defs.map((d, i) => (
                  <Bar
                    key={d.key} dataKey={d.key} stackId="kwh" fill={d.color}
                    stroke="var(--surface)" strokeWidth={2} maxBarSize={22} isAnimationActive={false}
                    radius={i === defs.length - 1 ? [4, 4, 0, 0] : 0}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 border-t border-line pt-3"><Legend defs={defs} /></div>
          <table className="sr-only-table">
            <caption>Konsumsi energi harian per jalur (kWh)</caption>
            <thead><tr><th>Tanggal</th>{defs.map((d) => <th key={d.key}>{d.label}</th>)}</tr></thead>
            <tbody>{barData.map((r) => <tr key={String(r.ts)}><td>{r.label}</td>{defs.map((d) => <td key={d.key}>{fmtNum(Number(r[d.key]), 1)}</td>)}</tr>)}</tbody>
          </table>
        </Card>

        <Card>
          <CardHeader title="Porsi energi per jalur" className="pb-3" />
          {ranked.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-fg-3">Belum ada jalur.</p>
          ) : (
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
                      <span className="w-24 text-right text-xs text-fg-3 tabular-nums">{fmtNum(kwh, 1)} kWh</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <Card className="relative p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium text-fg">Faktor daya per jalur</h2>
              <p className="mt-1 text-[13px] text-fg-3">Rata-rata harian · target {fmtNum(PF_TARGET, 2)}</p>
            </div>
            <Select aria-label="Pilih jalur" value={pfJalur} onChange={(e) => setPfJalur(e.target.value)} className="w-full sm:w-44">
              <option value="all">Semua jalur</option>
              {app.jalur.filter((j) => j.number <= 5).map((j) => (
                <option key={j.id} value={j.id}>Jalur {j.number} · {j.name}</option>
              ))}
            </Select>
          </div>
          <div role="img" aria-label="Grafik garis rata-rata faktor daya harian per jalur" className="mt-4 h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={pfData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="label" interval={4} tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--axis)" }} tickMargin={10} />
                <YAxis domain={[0.6, 1]} ticks={[0.6, 0.7, 0.8, 0.9, 1]} width={40} tickFormatter={(v: number) => fmtNum(v, 1)} tick={AXIS} tickLine={false} axisLine={false} />
                <ReferenceLine y={PF_TARGET} stroke="var(--fg-3)" strokeDasharray="5 4" strokeWidth={1.25} />
                <Tooltip
                  isAnimationActive={false}
                  cursor={{ stroke: "var(--fg-3)" }}
                  content={({ active, label, payload }) => {
                    const row = payload?.[0]?.payload as Record<string, number | null> | undefined;
                    return (
                      <Tip active={active} label={String(label ?? "")} unit="" digits={2}
                        rows={pfDefs.map((d) => ({ key: d.key, label: d.label, color: d.color, value: row?.[d.key] ?? null }))} />
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
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line pt-3">
            <Legend defs={pfDefs} />
            <span className="inline-flex items-center gap-2 text-xs text-fg-2">
              <svg width="20" height="2" aria-hidden><line x1="0" y1="1" x2="20" y2="1" stroke="var(--fg-3)" strokeWidth="1.5" strokeDasharray="4 3" /></svg>
              Target {fmtNum(PF_TARGET, 2)}
            </span>
          </div>
          <table className="sr-only-table">
            <caption>Rata-rata faktor daya harian per jalur</caption>
            <thead><tr><th>Tanggal</th>{pfDefs.map((d) => <th key={d.key}>{d.label}</th>)}</tr></thead>
            <tbody>{pfData.map((r) => <tr key={String(r.ts)}><td>{r.label}</td>{pfDefs.map((d) => <td key={d.key}>{r[d.key] == null ? "—" : fmtNum(Number(r[d.key]), 2)}</td>)}</tr>)}</tbody>
          </table>
        </Card>

        <Card>
          <div className="flex items-start justify-between gap-3 px-5 pt-5">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-medium text-primary">
                <Zap className="h-[18px] w-[18px]" /> Rekomendasi efisiensi
              </h2>
              <p className="mt-1 text-[13px] text-fg-3">Berdasarkan pola penggunaan fasilitas Anda</p>
            </div>
            <Badge tone="primary">{visibleRecs.length} temuan</Badge>
          </div>
          {visibleRecs.length === 0 ? (
            <p className="mt-4 border-t border-line px-5 py-8 text-center text-[13px] text-fg-3">
              Tidak ada temuan. Penggunaan energi sesuai pola normal.
            </p>
          ) : (
            <ul className="mt-4 border-t border-line">
              {visibleRecs.map((r) => (
                <li key={r.id} className="border-b border-line px-5 py-4 last:border-b-0">
                  <p className="font-bold text-fg">{r.title}</p>
                  <p className="mt-1 text-[13px] text-fg-3">{r.detail}</p>
                  <p className="mt-2 text-[13px] font-bold text-success">{savingText(r.savingRp)}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" onClick={() => router.push(`/jalur/${r.jalurNumber}?param=${r.link.param}&range=${r.link.range}`)}>
                      Lihat data
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => actions.dismissRec(r.id)}>
                      Abaikan
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
