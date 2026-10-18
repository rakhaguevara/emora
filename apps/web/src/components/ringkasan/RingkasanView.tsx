"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ConfirmRelay, type RelayAction } from "@/components/jalur/ConfirmRelay";
import { Card } from "@/components/ui/Card";
import { PageSkeleton } from "@/components/ui/PageHeader";
import { formatTick, niceDomain, timeTicks } from "@/lib/chart";
import { jalurStatus } from "@/lib/derive";
import { fmtAgo, fmtDay, fmtHM, fmtNum, fmtSmart, tickDigits } from "@/lib/format";
import { computeOverview } from "@/lib/overview";
import { actions, isLive, useApp, useLive } from "@/lib/store";
import type { Jalur, JalurStatus } from "@/lib/types";
import { EnergyCard } from "./EnergyCard";
import { JalurCard } from "./JalurCard";
import { JalurPager } from "./JalurPager";
import { PanelStrip } from "./PanelStrip";
import { PowerCard } from "./PowerCard";
import { RecentEvents } from "./RecentEvents";
import { SummaryCarousel } from "./SummaryCarousel";

export function RingkasanView() {
  const app = useApp();
  const live = useLive();
  const [confirm, setConfirm] = useState<{ j: Jalur; action: RelayAction } | null>(null);

  const minute = live ? Math.floor(live.now / 60e3) : 0;
  const to = minute * 60e3;
  const from = to - 24 * 3600e3;

  // Per menit, bukan per detik: ratusan sampel per perhitungan.
  const heavy = useMemo(
    () => (app ? computeOverview(app, to) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [app?.anomalies, app?.offLog, app?.jalur, app?.seededAt, to],
  );

  if (!app || !live || !heavy) return <PageSkeleton />;

  const rows = app.jalur.map((j) => ({ j, s: live.readings[j.id], status: jalurStatus(app, j) }));
  const counts: Record<JalurStatus, number> = { normal: 0, warning: 0, trip: 0, offline: 0, off: 0 };
  for (const r of rows) counts[r.status]++;

  const loaded = rows.filter((r) => r.j.relayOn && r.s);
  const watts = loaded.reduce((sum, r) => sum + r.s!.power, 0);
  const online = rows.filter((r) => r.s);
  const avgVoltage = online.length ? online.reduce((s, r) => s + r.s!.voltage, 0) / online.length : null;
  const pfRows = loaded.filter((r) => r.s!.pf != null && r.s!.power > 0);
  const pfPower = pfRows.reduce((s, r) => s + r.s!.power, 0);
  const pf = pfPower > 0 ? pfRows.reduce((s, r) => s + r.s!.pf! * r.s!.power, 0) / pfPower : null;
  const top = [...loaded].sort((a, b) => b.s!.power - a.s!.power)[0];
  const biggest = top && watts > 0 ? { label: `Jalur ${top.j.number}`, sharePct: (top.s!.power / watts) * 100 } : null;
  const kwh = rows.reduce((sum, r) => sum + (r.s?.energyKwh ?? 0), 0);
  const vsYesterday = heavy.yesterdayKwh >= 1 ? ((heavy.todayKwh - heavy.yesterdayKwh) / heavy.yesterdayKwh) * 100 : null;
  const running = rows.filter((r) => r.j.relayOn && r.j.sensorOnline).length;
  const lastSeen = Math.max(0, ...Object.values(live.lastSeen));

  // Beban kecil (< 1 kW) ditampilkan dalam W agar grafik tidak rata di 0 kW
  const peakW = Math.max(0, ...heavy.total.map((p) => p.w));
  const inW = peakW < 1000;
  const unit = inW ? "W" : "kW";
  const chart = heavy.total.map((p) => ({ ts: p.ts, kw: inW ? p.w : p.w / 1000 }));
  const scale = niceDomain(0, Math.max(1, ...chart.map((t) => t.kw)) * 1.1, 4);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[26px] leading-tight font-medium text-fg">Selamat datang di EMORA</h1>
        <p className="mt-1 text-[13px] text-fg-3">Pantau listrik fasilitas Anda, langsung dari sini.</p>
      </header>
      <PanelStrip panelName={app.facility.panelName} updated={fmtAgo(live.now - lastSeen)} counts={counts} />

      <SummaryCarousel
        slides={[
          {
            id: "daya",
            label: "Daya",
            node: (
              <PowerCard
                watts={watts} limitW={app.panel.limitW} peak={heavy.peak} avg1h={heavy.avg1h}
                active={running} total={app.jalur.length} avgVoltage={avgVoltage}
              />
            ),
          },
          {
            id: "energi",
            label: "Energi",
            node: (
              <EnergyCard
                kwh={kwh} vsYesterdayPct={vsYesterday} projectionKwh={heavy.monthProjectionKwh} pf={pf} biggest={biggest}
              />
            ),
          },
          { id: "kejadian", label: "Kejadian", node: <RecentEvents app={app} now={live.now} /> },
        ]}
      />

      <section aria-labelledby="status-jalur">
        <h2 id="status-jalur" className="mb-3 text-xl font-medium text-fg">Status jalur</h2>
        {rows.length === 0 ? (
          <Card className="px-5 py-8 text-center text-[13px] text-fg-3">
            Belum ada jalur. Tambahkan sensor di halaman Perangkat.
          </Card>
        ) : (
          <JalurPager
            items={rows}
            render={({ j, s, status }) => (
              <JalurCard
                key={j.id} jalur={j} sample={s} status={status} temperature={isLive ? (live.env?.temperature ?? null) : undefined}
                onRelay={(next) => setConfirm({ j, action: next ? "on" : "off" })}
              />
            )}
          />
        )}
      </section>

      <Card className="p-5">
        <h2 className="text-lg font-medium text-fg">Daya total 24 jam terakhir</h2>
        <p className="mt-1 text-[13px] text-fg-3">Jumlah seluruh jalur, rata-rata per 5 menit · waktu lokal WIB</p>
        <div role="img" aria-label="Grafik garis daya total seluruh jalur dalam 24 jam terakhir" className="mt-4 h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis
                dataKey="ts" type="number" scale="time" domain={[from, to]} ticks={timeTicks(from, to, 4 * 3600e3)}
                tickFormatter={(v: number) => formatTick(v, "24h")} tick={{ fill: "var(--fg-3)", fontSize: 11 }}
                tickLine={false} axisLine={{ stroke: "var(--axis)" }} tickMargin={10}
              />
              <YAxis domain={scale.domain} ticks={scale.ticks} width={52} tickFormatter={(v: number) => `${fmtNum(v, tickDigits(scale.ticks))} ${unit}`}
                tick={{ fill: "var(--fg-3)", fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                isAnimationActive={false} cursor={{ stroke: "var(--fg-3)" }}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as { ts: number; kw: number } | undefined;
                  if (!active || !p) return null;
                  return (
                    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-[var(--shadow)]">
                      <div className="text-fg-3">{fmtDay(p.ts)}, {fmtHM(p.ts)}</div>
                      <div className="mt-0.5 text-sm font-semibold text-fg">{inW ? fmtSmart(p.kw, 0) : fmtNum(p.kw, 2)} {unit}</div>
                    </div>
                  );
                }}
              />
              <Line type="linear" dataKey="kw" stroke="var(--chart-line)" strokeWidth={2} dot={false}
                activeDot={{ r: 4, fill: "var(--chart-line)", stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <ConfirmRelay jalur={confirm?.j ?? null} action={confirm?.action ?? null} onClose={() => setConfirm(null)} />
    </div>
  );
}
