"use client";

import { AlertTriangle, WifiOff } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader, PageSkeleton } from "@/components/ui/PageHeader";
import { Switch } from "@/components/ui/Switch";
import { ConfirmRelayOff } from "@/components/jalur/ConfirmRelayOff";
import { formatTick, niceDomain, timeTicks } from "@/lib/chart";
import { TARIFF_PER_KWH } from "@/lib/constants";
import { activeEvents, jalurLabel, jalurStatus, STATUS_LABEL } from "@/lib/derive";
import { fmtDay, fmtHM, fmtNum, fmtRp } from "@/lib/format";
import { series } from "@/lib/sim/engine";
import { actions, useApp, useLive } from "@/lib/store";
import type { Jalur, JalurStatus } from "@/lib/types";

const TONE: Record<JalurStatus, "success" | "warning" | "danger" | "neutral"> = {
  normal: "success", warning: "warning", trip: "danger", off: "neutral", offline: "neutral",
};

function StatTile({ label, value, unit, sub, href }: { label: string; value: string; unit?: string; sub: string; href?: string }) {
  const body = (
    <div className="rounded-lg border border-line bg-surface p-4 h-full hover:border-line-strong">
      <p className="text-[13px] text-fg-2">{label}</p>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[26px] leading-none font-semibold text-fg">{value}</span>
        {unit && <span className="text-[13px] text-fg-3">{unit}</span>}
      </p>
      <p className="mt-2 text-xs text-fg-3">{sub}</p>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function RingkasanView() {
  const app = useApp();
  const live = useLive();
  const [confirm, setConfirm] = useState<Jalur | null>(null);

  const minute = live ? Math.floor(live.now / 60e3) : 0;
  const to = minute * 60e3;
  const from = to - 24 * 3600e3;

  const total = useMemo(() => {
    if (!app) return [];
    const per = app.jalur.map((j) => series(app, j, "power", from, to, 5 * 60e3));
    return (per[0] ?? []).map((p, i) => ({
      ts: p.ts,
      kw: per.reduce((s, arr) => s + (arr[i]?.value ?? 0), 0) / 1000,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?.anomalies, app?.offLog, app?.jalur, app?.seededAt, from, to]);

  if (!app || !live) return <PageSkeleton />;

  const rows = app.jalur.map((j) => ({ j, s: live.readings[j.id], status: jalurStatus(app, j) }));
  const kw = rows.reduce((sum, r) => sum + (r.j.relayOn && r.s ? r.s.power : 0), 0) / 1000;
  const loaded = rows.filter((r) => r.j.relayOn && r.s && r.s.power > 20).length;
  const kwh = rows.reduce((sum, r) => sum + (r.s?.energyKwh ?? 0), 0);
  const running = rows.filter((r) => r.j.relayOn && r.j.sensorOnline).length;
  const active = activeEvents(app);
  const unack = active.filter((e) => !e.acknowledged).length;
  const scale = niceDomain(0, Math.max(1, ...total.map((t) => t.kw)) * 1.1, 4);

  return (
    <>
      <PageHeader title="Ringkasan" subtitle={`Kondisi seluruh jalur di ${app.facility.panelName}`} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Daya total saat ini" value={fmtNum(kw, 1)} unit="kW" sub={`${loaded} jalur sedang berbeban`} />
        <StatTile label="Energi hari ini" value={fmtNum(kwh, 1)} unit="kWh" sub={`≈ ${fmtRp(kwh * TARIFF_PER_KWH)}`} />
        <StatTile label="Jalur aktif" value={`${running}`} unit={`dari ${app.jalur.length}`} sub="Relai ON dan sensor merespons" />
        <StatTile
          label="Peringatan aktif" value={String(active.length)}
          sub={unack ? `${unack} belum diakui` : active.length ? "Semua sudah diakui" : "Tidak ada kejadian aktif"}
          href="/peringatan"
        />
      </div>

      <Card className="mt-5 overflow-hidden">
        <CardHeader title="Jalur" subtitle="Pembacaan langsung, diperbarui setiap detik" className="pb-4" />
        {rows.length === 0 ? (
          <p className="border-t border-line px-5 py-8 text-center text-[13px] text-fg-3">
            Belum ada jalur. Tambahkan sensor di halaman Perangkat.
          </p>
        ) : (
          <>
          <ul className="border-t border-line md:hidden">
            {rows.map(({ j, s, status }) => {
              const on = j.relayOn && !!s;
              return (
                <li key={j.id} className="border-b border-line px-4 py-3.5 last:border-b-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/jalur/${j.number}`} className="font-bold text-fg hover:text-primary">{jalurLabel(j)}</Link>
                      <p className="text-xs text-fg-3">ID sensor {j.sensorId}</p>
                    </div>
                    <Switch
                      label={`Relai ${jalurLabel(j)}`}
                      checked={j.relayOn}
                      onChange={(next) => (next ? actions.setRelay(j.id, true) : setConfirm(j))}
                    />
                  </div>
                  <div className="mt-2.5 flex items-center justify-between">
                    <Badge
                      tone={TONE[status]}
                      icon={status === "trip" || status === "warning" ? <AlertTriangle className="h-3 w-3" /> : status === "offline" ? <WifiOff className="h-3 w-3" /> : undefined}
                    >
                      {STATUS_LABEL[status]}
                    </Badge>
                    <Link href={`/jalur/${j.number}`} className="text-[13px] font-semibold text-primary">Detail</Link>
                  </div>
                  <dl className="mt-3 grid grid-cols-4 gap-2 text-xs tabular-nums">
                    {[
                      ["Tegangan", s ? `${fmtNum(s.voltage, 0)} V` : "—"],
                      ["Arus", on ? `${fmtNum(s!.current, 1)} A` : "—"],
                      ["Daya", on ? `${fmtNum(s!.power, 0)} W` : "—"],
                      ["PF", on && s!.pf != null ? fmtNum(s!.pf, 2) : "—"],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-fg-3">{k}</dt>
                        <dd className="mt-0.5 font-semibold text-fg">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              );
            })}
          </ul>
          <div className="relative hidden overflow-x-auto border-t border-line md:block">
            <table className="w-full min-w-[780px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-[11px] tracking-wider text-fg-3 uppercase">
                  {["Jalur", "Status", "Tegangan", "Arus", "Daya", "PF", "Relai", ""].map((h, i) => (
                    <th key={i} scope="col" className="px-4 py-3 font-semibold first:pl-5">{h || <span className="sr-only">Detail</span>}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ j, s, status }) => {
                  const on = j.relayOn && !!s;
                  return (
                    <tr key={j.id} className="border-b border-line last:border-b-0">
                      <td className="py-3.5 pr-4 pl-5">
                        <Link href={`/jalur/${j.number}`} className="font-bold text-fg hover:text-primary">{jalurLabel(j)}</Link>
                        <p className="text-xs text-fg-3">ID sensor {j.sensorId}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge
                          tone={TONE[status]}
                          icon={status === "trip" || status === "warning" ? <AlertTriangle className="h-3 w-3" /> : status === "offline" ? <WifiOff className="h-3 w-3" /> : undefined}
                        >
                          {STATUS_LABEL[status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-fg-2 tabular-nums">{s ? `${fmtNum(s.voltage, 1)} V` : "—"}</td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-fg-2 tabular-nums">{on ? `${fmtNum(s!.current, 1)} A` : "—"}</td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-fg-2 tabular-nums">{on ? `${fmtNum(s!.power, 0)} W` : "—"}</td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-fg-2 tabular-nums">{on && s!.pf != null ? fmtNum(s!.pf, 2) : "—"}</td>
                      <td className="px-4 py-3.5">
                        <Switch
                          label={`Relai ${jalurLabel(j)}`}
                          checked={j.relayOn}
                          onChange={(next) => (next ? actions.setRelay(j.id, true) : setConfirm(j))}
                        />
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Link href={`/jalur/${j.number}`} className="text-[13px] font-semibold text-primary hover:underline">Detail</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      <Card className="mt-5 p-5">
        <h2 className="text-lg font-medium text-fg">Daya total 24 jam terakhir</h2>
        <p className="mt-1 text-[13px] text-fg-3">Jumlah seluruh jalur, rata-rata per 5 menit · waktu lokal WIB</p>
        <div role="img" aria-label="Grafik garis daya total seluruh jalur dalam 24 jam terakhir" className="mt-4 h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={total} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--grid)" vertical={false} />
              <XAxis
                dataKey="ts" type="number" scale="time" domain={[from, to]} ticks={timeTicks(from, to, 4 * 3600e3)}
                tickFormatter={(v: number) => formatTick(v, "24h")} tick={{ fill: "var(--fg-3)", fontSize: 11 }}
                tickLine={false} axisLine={{ stroke: "var(--axis)" }} tickMargin={10}
              />
              <YAxis domain={scale.domain} ticks={scale.ticks} width={52} tickFormatter={(v: number) => `${fmtNum(v, 0)} kW`}
                tick={{ fill: "var(--fg-3)", fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                isAnimationActive={false} cursor={{ stroke: "var(--fg-3)" }}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as { ts: number; kw: number } | undefined;
                  if (!active || !p) return null;
                  return (
                    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-[var(--shadow)]">
                      <div className="text-fg-3">{fmtDay(p.ts)}, {fmtHM(p.ts)}</div>
                      <div className="mt-0.5 text-sm font-semibold text-fg">{fmtNum(p.kw, 2)} kW</div>
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

      <ConfirmRelayOff jalur={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
