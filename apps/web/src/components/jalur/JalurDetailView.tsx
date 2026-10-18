"use client";

import { AlertTriangle, WifiOff } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageSkeleton } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/cn";
import { RANGE_META, type RangeKey } from "@/lib/chart";
import { FREQ_MAX, FREQ_MIN, PARAM_META } from "@/lib/constants";
import { activeEvents, jalurLabel, jalurStatus } from "@/lib/derive";
import { dayDiff, fmtAgo, fmtHM, fmtNum, fmtTime, fmtDay, fmtSmart, fmtEnergy } from "@/lib/format";
import { rangeStats } from "@/lib/sim/engine";
import { actions, isLive, useApp, useLive } from "@/lib/store";
import type { Param } from "@/lib/types";
import { ui } from "@/lib/ui";
import { ConfirmRelay, type RelayAction } from "./ConfirmRelay";
import { CutModeCard } from "./CutModeCard";
import { FeedbackInsights } from "./FeedbackInsights";
import { MetricCard } from "./MetricCard";
import { ParameterChart } from "./ParameterChart";
import { ThresholdForm } from "./ThresholdForm";

const PARAMS: Param[] = ["current", "voltage", "power", "pf", "frequency", ...(isLive ? (["temperature", "humidity"] as Param[]) : [])];
const RANGES: RangeKey[] = ["1h", "24h", "7d", "30d"];

function whenText(ts: number, now: number, withSeconds = true): string {
  const t = withSeconds ? fmtTime(ts) : fmtHM(ts);
  const d = dayDiff(now, ts);
  if (d === 0) return `hari ini, ${t}`;
  if (d === 1) return `kemarin, ${t}`;
  return `${fmtDay(ts)}, ${t}`;
}

export function JalurDetailView() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const app = useApp();
  const live = useLive();

  const initialParam = (PARAMS as string[]).includes(search.get("param") ?? "") ? (search.get("param") as Param) : "current";
  const initialRange = (RANGES as string[]).includes(search.get("range") ?? "") ? (search.get("range") as RangeKey) : "24h";
  const [param, setParam] = useState<Param>(initialParam);
  const [range, setRange] = useState<RangeKey>(initialRange);
  const [confirmRelay, setConfirmRelay] = useState<RelayAction | null>(null);

  const j = app?.jalur.find((x) => String(x.number) === params.id);
  const minute = live ? Math.floor(live.now / 60e3) : 0;

  const display = j && live ? (j.relayOn ? live.readings[j.id] : (j.offSnapshot ?? live.readings[j.id])) : null;

  const jOffLog = j ? app?.offLog[j.id] : undefined;

  const stats = useMemo(() => {
    if (!app || !j) return null;
    const extra = j.relayOn ? null : j.offSnapshot;
    const now = minute * 60e3;
    return Object.fromEntries(
      PARAMS.map((p) => [p, rangeStats(app, j, p, now, extra)]),
    ) as Record<Param, { min: number; max: number } | null>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?.anomalies, app?.seededAt, jOffLog, j?.relayOn, j?.offSnapshot, j?.number, j?.offlineSince, minute]);

  if (!app || !live) return <PageSkeleton />;
  if (!j) {
    return (
      <Card className="p-8 text-center">
        <p className="text-fg">Jalur tidak ditemukan.</p>
        <ButtonLink href="/" variant="primary" className="mt-4">Kembali ke Ringkasan</ButtonLink>
      </Card>
    );
  }

  const status = jalurStatus(app, j);
  const active = activeEvents(app, j.id);
  const trip = active.find((e) => e.type === "trip");
  const hold = app.holds[j.id];
  const warning = active.find((e) => e.type === "warning");
  const th = j.thresholds;

  const v = display;
  const cards: { p: Param | "energy"; label: string; value: string; unit: string; limit: string; alert: boolean }[] = [
    { p: "voltage", label: "Tegangan", value: v ? fmtNum(v.voltage, 1) : "—", unit: "V", limit: `Batas: ${fmtNum(th.voltMin, 0)}–${fmtNum(th.voltMax, 0)} V`, alert: !!v && (v.voltage < th.voltMin || v.voltage > th.voltMax) },
    { p: "current", label: "Arus", value: v ? fmtSmart(v.current, 1) : "—", unit: "A", limit: `Batas: Maks. ${fmtNum(th.currentMax, 1)} A`, alert: !!v && v.current > th.currentMax },
    { p: "power", label: "Daya", value: v ? fmtSmart(v.power, 0) : "—", unit: "W", limit: `Batas: Maks. ${fmtNum(th.powerMax, 0)} W`, alert: !!v && v.power > th.powerMax },
    { p: "pf", label: "Faktor daya", value: v?.pf != null ? fmtNum(v.pf, 2) : "—", unit: "PF", limit: `Batas: Min. ${fmtNum(th.pfMin, 2)}`, alert: !!v && v.pf != null && v.pf < th.pfMin },
    { p: "frequency", label: "Frekuensi", value: v ? fmtNum(v.frequency, 1) : "—", unit: "Hz", limit: `Batas: ${fmtNum(FREQ_MIN, 1)}–${fmtNum(FREQ_MAX, 1)} Hz`, alert: !!v && (v.frequency < FREQ_MIN || v.frequency > FREQ_MAX) },
    { p: "energy", label: "Energi", value: v ? fmtEnergy(v.energyKwh).value : "—", unit: v ? fmtEnergy(v.energyKwh).unit : "kWh", limit: "Batas: Tanpa batas", alert: false },
  ];
  if (isLive) {
    // DHT22 di panel: tetap terbaca walau PZEM gagal. Suhu hanya peringatan, tidak memicu trip.
    const t = live.env?.temperature;
    const h = live.env?.humidity;
    cards.push(
      {
        p: "temperature", label: "Suhu panel", value: t != null ? fmtNum(t, 1) : "—", unit: "°C",
        limit: th.tempMax != null ? `Peringatan > ${fmtNum(th.tempMax, 0)} °C · tidak memicu trip` : "Tidak memicu trip",
        alert: t != null && th.tempMax != null && t > th.tempMax,
      },
      { p: "humidity", label: "Kelembapan", value: h != null ? fmtNum(h, 0) : "—", unit: "%", limit: "Hanya pemantauan", alert: false },
    );
  }

  const statusBadge = {
    normal: <Badge tone="success">Normal</Badge>,
    warning: <Badge tone="warning" icon={<AlertTriangle className="h-3 w-3" />}>Peringatan</Badge>,
    trip: <Badge tone="danger" icon={<AlertTriangle className="h-3 w-3" />}>Trip</Badge>,
    off: <Badge tone="neutral">Relai OFF</Badge>,
    offline: <Badge tone="neutral" icon={<WifiOff className="h-3 w-3" />}>Offline</Badge>,
  }[status];

  const manual = active.find((e) => e.type === "manual");
  const offline = active.find((e) => e.type === "offline");
  const statusText =
    status === "trip" && trip ? `Trip ${whenText(trip.startedAt, live.now)}`
    : status === "off" ? (manual ? `Dimatikan pengguna ${whenText(manual.startedAt, live.now)}` : "Relai dimatikan")
    : status === "offline" ? `Terakhir terlihat ${j.offlineSince ? whenText(j.offlineSince, live.now) : "—"}`
    : status === "warning" && warning ? `Peringatan ${warning.param.toLowerCase()} sejak ${whenText(warning.startedAt, live.now)}`
    : `Beroperasi normal · diperbarui ${fmtAgo(live.now - live.lastSeen[j.id])}`;

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/" className="text-[13px] text-primary hover:underline">Jalur {j.number}</Link>
            <h1 className="text-[28px] leading-tight font-medium text-fg">{j.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2.5 text-[13px] text-fg-3">
              {statusBadge}
              <span>{statusText}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div>
              <p className="mb-1.5 text-xs text-fg-3">Kontrol relai</p>
              <div className="flex items-center gap-2.5">
                <Switch
                  label={`Relai ${jalurLabel(j)}`}
                  checked={j.relayOn}
                  onChange={(next) => setConfirmRelay(next ? "on" : "off")}
                />
                <span className="text-[13px] font-medium text-fg-2">{j.relayOn ? "Relai ON" : "Relai OFF"}</span>
              </div>
            </div>
            {status === "trip" && (
              <Button variant="danger" onClick={() => setConfirmRelay("on")}>
                Nyalakan kembali
              </Button>
            )}
          </div>
        </div>
      </Card>

      {status === "trip" && trip && (
        <div role="alert" className="flex flex-wrap gap-3 rounded-lg border border-danger-line bg-danger-soft p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-danger">
              Relai diputus {trip.cutSource === "manual" ? "manual" : trip.cutSource === "failsafe" ? "oleh pengaman" : trip.cutSource === "local" ? "oleh proteksi lokal ESP32" : "otomatis"} karena {trip.param.toLowerCase()} berlebih
            </p>
            <p className="mt-0.5 text-[13px] text-danger">{trip.note}</p>
          </div>
          {trip.cutSource && (
            trip.feedbackId ? (
              <span className="self-center text-[13px] font-medium text-danger">Feedback tercatat</span>
            ) : (
              <Button size="sm" className="self-center" onClick={() => ui.openFeedback(trip.id)}>
                Beri feedback
              </Button>
            )
          )}
        </div>
      )}
      {hold && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger-line bg-danger-soft p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-danger">Beban berlebih, menunggu keputusan</p>
            <p className="mt-0.5 text-[13px] text-danger">
              Relai tetap menyala. Pengaman memutus otomatis dalam {Math.max(0, Math.ceil((hold.deadline - live.now) / 1000))} detik bila tidak ada keputusan.
            </p>
          </div>
          <Button size="sm" variant="danger" onClick={() => ui.reopenHold(`${hold.jalurId}:${hold.startedAt}`)}>
            Tindak
          </Button>
        </div>
      )}
      {status === "warning" && warning && (
        <div role="status" className="flex gap-3 rounded-lg border border-warning-line/60 bg-warning-soft p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <p className="font-bold text-warning">{warning.param} di luar kondisi normal</p>
            <p className="mt-0.5 text-[13px] text-warning">
              Nilai {fmtNum(warning.value ?? 0, warning.unit === "W" ? 0 : warning.unit === "" ? 2 : 1)} {warning.unit} terhadap batas{" "}
              {fmtNum(warning.limit ?? 0, warning.unit === "W" ? 0 : warning.unit === "" ? 2 : 1)} {warning.unit}.
            </p>
          </div>
        </div>
      )}
      {status === "offline" && offline && (
        <div role="status" className="flex gap-3 rounded-lg border border-line-strong bg-surface-2 p-4">
          <WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-fg-2" />
          <div>
            <p className="font-bold text-fg">Sensor {j.sensorId} tidak merespons</p>
            <p className="mt-0.5 text-[13px] text-fg-2">Tidak ada data masuk dari sensor. Periksa kabel RS485 dan catu daya sensor.</p>
          </div>
        </div>
      )}

      <div className={cn("grid grid-cols-2 gap-3", isLive ? "md:grid-cols-4" : "md:grid-cols-3 xl:grid-cols-6")}>
        {cards.map((c) => {
          const s = c.p === "energy" ? null : stats?.[c.p];
          return (
            <MetricCard
              key={c.p}
              label={c.label}
              value={c.value}
              unit={c.unit}
              limit={c.limit}
              alert={c.alert}
              minMax={
                c.p === "energy" || !s
                  ? "— / —"
                  : `${fmtSmart(s.min, PARAM_META[c.p].digits)} / ${fmtSmart(s.max, PARAM_META[c.p].digits)}`
              }
            />
          );
        })}
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-fg">Riwayat parameter</h2>
            <p className="mt-1 text-[13px] text-fg-3">{RANGE_META[range].caption} · waktu lokal WIB</p>
          </div>
          <div className="flex w-full items-center gap-3 sm:w-auto">
            <Select aria-label="Parameter" value={param} onChange={(e) => setParam(e.target.value as Param)} className="min-w-0 flex-1 sm:w-44 sm:flex-none">
              {PARAMS.map((p) => (
                <option key={p} value={p}>
                  {PARAM_META[p].label} ({PARAM_META[p].unit})
                </option>
              ))}
            </Select>
            <div role="group" aria-label="Rentang waktu" className="inline-flex shrink-0 overflow-hidden rounded-md border border-line-strong">
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={range === r}
                  onClick={() => setRange(r)}
                  className={cn(
                    "h-10 min-w-10 border-r border-line-strong px-2.5 text-sm whitespace-nowrap last:border-r-0 sm:min-w-11 sm:px-3",
                    range === r ? "bg-primary-soft font-semibold text-primary" : "bg-surface text-fg-2 hover:bg-surface-2",
                  )}
                >
                  {RANGE_META[r].label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4">
          <ParameterChart app={app} jalur={j} param={param} range={range} now={live.now} />
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <CutModeCard jalur={j} hasHold={!!hold} />
        <FeedbackInsights app={app} />
      </div>

      <ThresholdForm key={j.thresholdsChangedAt + j.id} jalur={j} />

      <ConfirmRelay jalur={confirmRelay ? j : null} action={confirmRelay} onClose={() => setConfirmRelay(null)} />
    </div>
  );
}
