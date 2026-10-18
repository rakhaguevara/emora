"use client";

import { Check, Clock, MoreHorizontal, Server, Wifi, WifiOff, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { Menu } from "@/components/ui/Menu";
import { PageHeader, PageSkeleton } from "@/components/ui/PageHeader";
import { cn } from "@/lib/cn";
import { jalurLabel } from "@/lib/derive";
import { fmtAgo, fmtUptime } from "@/lib/format";
import { actions, useApp, useLive } from "@/lib/store";

function rssiLabel(rssi: number): string {
  if (rssi >= -50) return "Sangat baik";
  if (rssi >= -67) return "Baik";
  if (rssi >= -75) return "Cukup";
  return "Lemah";
}

export function PerangkatView() {
  const app = useApp();
  const live = useLive();
  const router = useRouter();

  if (!app || !live) return <PageSkeleton />;

  const sorted = [...app.jalur].sort((a, b) => a.sensorId.localeCompare(b.sensorId));
  const voltageOk = app.jalur.every((j) => {
    const s = live.readings[j.id];
    return !s || (s.voltage >= j.thresholds.voltMin && s.voltage <= j.thresholds.voltMax);
  });

  const stats = [
    { icon: Wifi, label: "Sinyal Wi-Fi", value: `−${Math.abs(live.panelRssi)} dBm · ${rssiLabel(live.panelRssi)}` },
    { icon: Clock, label: "Waktu aktif", value: fmtUptime(live.now - app.panel.bootedAt) },
    { icon: Clock, label: "Terakhir terlihat", value: fmtAgo(1000) },
    { icon: Zap, label: "Catu daya", value: voltageOk ? "Stabil" : "Tidak stabil" },
  ];

  return (
    <>
      <PageHeader title="Perangkat" subtitle="Kesehatan panel, pengontrol ESP32, dan sensor cabang. Data perangkat dikelola admin." />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-lg font-medium text-fg">{app.facility.panelName}</h2>
                <Badge tone="success" icon={<Check className="h-3 w-3" />}>Terhubung</Badge>
              </div>
              <p className="text-[13px] text-fg-3">
                {app.panel.deviceId} · Firmware {app.panel.firmware}
              </p>
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 border-t border-line lg:grid-cols-4">
          {stats.map(({ icon: Icon, label, value }, i) => (
            <div key={label} className={cn("flex items-start gap-3 p-4", i > 0 && "lg:border-l lg:border-line", i % 2 === 1 && "border-l border-line lg:border-l")}>
              <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-fg-3" />
              <div>
                <dt className="text-xs text-fg-3">{label}</dt>
                <dd className="mt-0.5 text-[13px] font-bold text-fg">{value}</dd>
              </div>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="mt-5">
        <CardHeader
          title="Kesehatan sensor per jalur"
          subtitle="PZEM-004T · pembaruan sekitar setiap 1 detik"
          className="pb-4"
        />
        {sorted.length === 0 ? (
          <p className="border-t border-line px-5 py-8 text-center text-[13px] text-fg-3">
            Belum ada jalur. Minta admin mendaftarkan perangkat.
          </p>
        ) : (
          <ul className="border-t border-line">
            {sorted.map((j) => {
              const online = j.sensorOnline;
              const seen = live.lastSeen[j.id];
              return (
                <li key={j.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-line px-4 py-4 last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_6rem_10rem_auto] sm:px-5">
                  <div
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                      online ? "bg-primary-soft text-primary" : "bg-surface-2 text-fg-3",
                    )}
                  >
                    <Zap className="h-[18px] w-[18px]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-bold text-fg">{jalurLabel(j)}</p>
                    <p className="text-[13px] text-fg-3">ID sensor {j.sensorId}</p>
                  </div>
                  <p className="hidden text-[13px] text-fg-3 sm:block">{online ? fmtAgo(live.now - seen) : "—"}</p>
                  <div className="order-4 col-span-2 col-start-2 text-[13px] font-semibold whitespace-nowrap sm:order-none sm:col-span-1 sm:col-start-auto">
                    {online ? (
                      <span className="inline-flex items-center gap-1.5 text-success">
                        <Check className="h-3.5 w-3.5" /> Sehat
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-fg-2">
                        <WifiOff className="h-3.5 w-3.5" /> Tidak merespons
                      </span>
                    )}
                  </div>
                  <div className="order-3 sm:order-none">
                  <Menu
                    label={`Aksi untuk ${jalurLabel(j)}`}
                    trigger={
                      <span className="flex h-10 w-10 items-center justify-center rounded-md border border-line-strong bg-surface text-fg-2 hover:bg-surface-2">
                        <MoreHorizontal className="h-4 w-4" />
                      </span>
                    }
                    items={[
                      { label: "Lihat detail", onSelect: () => router.push(`/jalur/${j.number}`) },
                      { label: "Uji koneksi", onSelect: () => actions.testConnection(j.id) },
                    ]}
                  />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
