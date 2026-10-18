"use client";

import { useMemo, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { PageHeader, PageSkeleton } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import { CUT_SOURCE_LABEL, EVENT_TYPE_LABEL } from "@/lib/constants";
import { downloadCsv } from "@/lib/csv";
import { eventJalurLabel, eventReviewHref, eventValueText } from "@/lib/derive";
import { fmtDuration, fmtEventTime, fmtNum, fmtDateTimeLong } from "@/lib/format";
import { actions, isLive, useApp, useLive } from "@/lib/store";
import { ui } from "@/lib/ui";
import type { AlertEvent, EventType } from "@/lib/types";

const RANGES = [
  { value: "1", label: "24 jam terakhir", days: 1 },
  { value: "7", label: "7 hari terakhir", days: 7 },
  { value: "30", label: "30 hari terakhir", days: 30 },
  { value: "all", label: "Semua waktu", days: Infinity },
];

const TYPE_STYLE: Record<EventType, string> = {
  trip: "text-danger",
  warning: "text-warning",
  offline: "text-fg-3",
  manual: "text-fg-3",
  config: "text-fg-2",
};

export function PeringatanView() {
  const app = useApp();
  const live = useLive();
  const [jalur, setJalur] = useState("all");
  const [type, setType] = useState("all");
  const [range, setRange] = useState("7");
  const [confirmClear, setConfirmClear] = useState(false);

  const now = live?.now ?? 0;
  const rows = useMemo(() => {
    if (!app) return [];
    const days = RANGES.find((r) => r.value === range)!.days;
    const from = now - days * 86400e3;
    return app.events
      .filter((e) => (jalur === "all" || e.jalurId === jalur) && (type === "all" || e.type === type) && e.startedAt >= from)
      .sort((a, b) => b.startedAt - a.startedAt);
  }, [app, jalur, type, range, now]);

  if (!app || !live) return <PageSkeleton />;

  const filtered = jalur !== "all" || type !== "all" || range !== "7";
  const durationOf = (e: AlertEvent) => {
    if (e.type === "config") return "—";
    return fmtDuration((e.endedAt ?? live.now) - e.startedAt);
  };

  const exportCsv = () => {
    const header = ["Waktu", "Jalur", "Jenis", "Parameter", "Nilai vs batas", "Durasi", "Status", "Ditangani oleh"];
    const body = rows.map((e) => [
      fmtDateTimeLong(e.startedAt),
      eventJalurLabel(app, e),
      EVENT_TYPE_LABEL[e.type],
      e.param,
      eventValueText(e, fmtNum),
      durationOf(e),
      e.endedAt == null ? "Aktif" : "Selesai",
      e.handledBy ?? "",
    ]);
    downloadCsv(`emora-kejadian-${new Date(live.now).toISOString().slice(0, 10)}.csv`, [header, ...body]);
  };

  return (
    <>
      <PageHeader
        title="Peringatan & Kejadian"
        subtitle="Riwayat perubahan status dan tindakan pada semua jalur"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setConfirmClear(true)} disabled={app.events.length === 0}>
              Bersihkan notifikasi
            </Button>
            <Button onClick={exportCsv} disabled={rows.length === 0}>
              Ekspor CSV
            </Button>
          </div>
        }
      />

      <Dialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="Bersihkan notifikasi?"
        description={
          isLive
            ? `${app.events.length} kejadian akan disembunyikan dari dashboard di browser ini. Data di Supabase tidak dihapus. Kejadian baru tetap muncul.`
            : `${app.events.length} kejadian akan dihapus dari data demo. Kejadian baru tetap muncul.`
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>
              Batal
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                actions.clearEvents();
                setConfirmClear(false);
              }}
            >
              Bersihkan
            </Button>
          </>
        }
      />

      <Card className="mb-4 p-5">
        <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap sm:gap-4">
          <div>
            <label htmlFor="f-jalur" className="mb-1.5 block text-xs font-semibold text-fg">Jalur</label>
            <Select id="f-jalur" value={jalur} onChange={(e) => setJalur(e.target.value)} className="w-full sm:w-44">
              <option value="all">Semua jalur</option>
              {app.jalur.map((j) => (
                <option key={j.id} value={j.id}>Jalur {j.number} · {j.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="f-jenis" className="mb-1.5 block text-xs font-semibold text-fg">Jenis</label>
            <Select id="f-jenis" value={type} onChange={(e) => setType(e.target.value)} className="w-full sm:w-44">
              <option value="all">Semua jenis</option>
              {(Object.keys(EVENT_TYPE_LABEL) as EventType[]).map((t) => (
                <option key={t} value={t}>{EVENT_TYPE_LABEL[t]}</option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="f-rentang" className="mb-1.5 block text-xs font-semibold text-fg">Rentang tanggal</label>
            <Select id="f-rentang" value={range} onChange={(e) => setRange(e.target.value)} className="w-full sm:w-44">
              {RANGES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </Select>
          </div>
          <Button
            variant="ghost"
            disabled={!filtered}
            onClick={() => {
              setJalur("all");
              setType("all");
              setRange("7");
            }}
          >
            Atur ulang
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <ul className="md:hidden">
          {rows.length === 0 && <li className="px-5 py-10 text-center text-[13px] text-fg-3">Tidak ada kejadian untuk filter ini.</li>}
          {rows.map((e) => {
            const active = e.endedAt == null;
            const needsAck = active && !e.acknowledged;
            const review = eventReviewHref(app, e, live.now);
            return (
              <li key={e.id} className={cn("border-b border-line px-4 py-3.5 last:border-b-0", needsAck && "border-l-[3px] border-l-warning-line bg-warning-soft")}>
                <div className="flex items-center justify-between gap-3 text-[13px]">
                  <span className={cn("font-bold", TYPE_STYLE[e.type])}>
                    {EVENT_TYPE_LABEL[e.type]}{e.cutSource ? ` ${CUT_SOURCE_LABEL[e.cutSource].toLowerCase()}` : ""} <span className="font-normal text-fg-2">· {e.param}</span>
                  </span>
                  <span className="text-xs text-fg-3 tabular-nums">{fmtEventTime(e.startedAt, live.now)}</span>
                </div>
                <p className="mt-1 font-bold text-fg">{eventJalurLabel(app, e)}</p>
                <p className="mt-0.5 text-[13px] text-fg-2 tabular-nums">{eventValueText(e, fmtNum)}</p>
                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-fg-2">
                  <span className="inline-flex items-center gap-1.5">
                    {e.type !== "config" && <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-danger-solid" : "bg-success")} />}
                    {e.type === "config" ? "Konfigurasi" : active ? "Aktif" : "Selesai"} · {durationOf(e)}
                  </span>
                  {needsAck ? (
                    <button
                      type="button"
                      onClick={() => actions.acknowledge(e.id)}
                      className="rounded-md border border-warning-line bg-surface px-3 py-1 text-xs font-bold text-warning"
                    >
                      Akui
                    </button>
                  ) : (
                    <span>{e.handledBy ?? "—"}</span>
                  )}
                </div>
                {needsFeedback(e) && (
                  <Button size="sm" className="mt-3 w-full" onClick={() => ui.openFeedback(e.id)}>
                    Beri feedback
                  </Button>
                )}
                {review && (
                  <ButtonLink href={review} size="sm" className="mt-3 w-full">
                    Tinjau {e.type === "trip" || e.type === "warning" ? "masalah" : "jalur"}
                  </ButtonLink>
                )}
              </li>
            );
          })}
        </ul>
        <div className="relative hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1020px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-[11px] tracking-wider text-fg-3 uppercase">
                {["Waktu", "Jalur", "Jenis", "Parameter", "Nilai vs batas", "Durasi", "Status", "Ditangani oleh", "Aksi"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 font-semibold first:pl-5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-fg-3">
                    Tidak ada kejadian untuk filter ini.
                  </td>
                </tr>
              )}
              {rows.map((e) => {
                const active = e.endedAt == null;
                const needsAck = active && !e.acknowledged;
                const review = eventReviewHref(app, e, live.now);
                return (
                  <tr key={e.id} className={cn("border-b border-line last:border-b-0", needsAck && "bg-warning-soft")}>
                    <td className={cn("py-3.5 pr-4 pl-5 whitespace-nowrap text-fg-2 tabular-nums", needsAck && "border-l-[3px] border-warning-line !pl-[17px]")}>
                      {fmtEventTime(e.startedAt, live.now)}
                    </td>
                    <td className="px-4 py-3.5 font-bold whitespace-nowrap text-fg">{eventJalurLabel(app, e)}</td>
                    <td className={cn("px-4 py-3.5 font-bold", TYPE_STYLE[e.type])}>
                      {EVENT_TYPE_LABEL[e.type]}
                      {e.cutSource && <span className="block text-[11px] font-normal text-fg-3">{CUT_SOURCE_LABEL[e.cutSource]}</span>}
                    </td>
                    <td className="px-4 py-3.5 text-fg-2">{e.param}</td>
                    <td className="max-w-64 px-4 py-3.5 text-fg-2 tabular-nums">{eventValueText(e, fmtNum)}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-fg-2 tabular-nums">{durationOf(e)}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {e.type === "config" ? (
                        <span className="text-fg-3">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-fg-2">
                          <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-danger-solid" : "bg-success")} />
                          {active ? "Aktif" : "Selesai"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-fg-2">
                      {needsAck ? (
                        <button
                          type="button"
                          onClick={() => actions.acknowledge(e.id)}
                          className="rounded-md border border-warning-line bg-surface px-3 py-1 text-xs font-bold text-warning hover:bg-warning-soft"
                        >
                          Akui
                        </button>
                      ) : (
                        (e.handledBy ?? "—")
                      )}
                    </td>
                    <td className="space-x-2 px-4 py-3.5 whitespace-nowrap">
                      {needsFeedback(e) && (
                        <Button size="sm" onClick={() => ui.openFeedback(e.id)}>
                          Feedback
                        </Button>
                      )}
                      {review ? (
                        <ButtonLink href={review} size="sm" aria-label={`Tinjau ${EVENT_TYPE_LABEL[e.type].toLowerCase()} ${eventJalurLabel(app, e)}`}>
                          Tinjau
                        </ButtonLink>
                      ) : (
                        <span className="text-fg-3">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// Pemutusan relai yang belum diberi feedback
const needsFeedback = (e: AlertEvent) => e.type === "trip" && !!e.cutSource && !e.feedbackId;
