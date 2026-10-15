"use client";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { CUT_SOURCE_LABEL, MIN_FEEDBACK_PER_GROUP } from "@/lib/constants";
import { downloadCsv } from "@/lib/csv";
import { eventJalurLabel } from "@/lib/derive";
import { fmtDateTimeLong, fmtNum } from "@/lib/format";
import { adviseCutMode, type GroupStats } from "@/lib/ml";
import type { AppState } from "@/lib/types";

const CAUSE: Record<string, string> = { load_up: "Beban kerja naik", equipment: "Masalah peralatan", surge: "Lonjakan sesaat", unknown: "Belum diketahui" };
const OUTCOME: Record<string, string> = { none: "Tidak ada dampak", minor: "Dampak ringan", severe: "Dampak berat" };
const TIMING: Record<string, string> = { early: "Terlalu cepat", right: "Tepat", late: "Terlambat" };

function Group({ title, g }: { title: string; g: GroupStats }) {
  const pct = (n: number) => (g.n ? `${fmtNum((n / g.n) * 100, 0)}%` : "—");
  return (
    <div className="rounded-md border border-line p-3.5">
      <p className="text-[13px] font-semibold text-fg">{title}</p>
      <p className="mt-1 text-xs text-fg-3">{g.n} feedback</p>
      <dl className="mt-2.5 space-y-1 text-xs tabular-nums">
        <div className="flex justify-between"><dt className="text-fg-3">Tanpa dampak</dt><dd className="font-semibold text-fg">{pct(g.none)}</dd></div>
        <div className="flex justify-between"><dt className="text-fg-3">Dampak ringan</dt><dd className="font-semibold text-fg">{pct(g.minor)}</dd></div>
        <div className="flex justify-between"><dt className="text-fg-3">Dampak berat</dt><dd className="font-semibold text-fg">{pct(g.severe)}</dd></div>
      </dl>
      <div className="mt-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full rounded-full bg-primary-solid" style={{ width: `${g.adverseRate == null ? 0 : g.adverseRate * 100}%` }} />
        </div>
        <p className="mt-1 text-[11px] text-fg-3">
          Indeks dampak buruk {g.adverseRate == null ? "—" : fmtNum(g.adverseRate * 100, 0) + "%"}
        </p>
      </div>
    </div>
  );
}

export function FeedbackInsights({ app }: { app: AppState }) {
  const advice = adviseCutMode(app.feedback);

  const exportCsv = () => {
    const header = ["Waktu", "Jalur", "Pemutusan", "Parameter", "Nilai", "Batas", "Rasio", "Durasi beban berlebih (dtk)", "Dampak", "Waktu pemutusan", "Dugaan penyebab", "Catatan"];
    const rows = app.feedback.map((f) => {
      const ev = app.events.find((e) => e.id === f.eventId);
      return [
        fmtDateTimeLong(f.ts),
        ev ? eventJalurLabel(app, ev) : f.jalurId,
        CUT_SOURCE_LABEL[f.cutSource],
        f.context.param,
        String(f.context.value),
        String(f.context.limit),
        f.context.ratio.toFixed(3),
        String(f.context.overloadSec),
        OUTCOME[f.outcome],
        TIMING[f.timing],
        CAUSE[f.cause],
        f.comment,
      ];
    });
    downloadCsv("emora-feedback-pemutusan.csv", [header, ...rows]);
  };

  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Pembelajaran dari feedback"
        subtitle="Perbandingan dampak pemutusan manual dan otomatis, semua jalur"
      />
      <div className="grid gap-3 px-5 pt-4 sm:grid-cols-2">
        <Group title="Manual" g={advice.manual} />
        <Group title="Otomatis & pengaman" g={advice.auto} />
      </div>
      <p className="mx-5 mt-3 rounded-md bg-surface-2 px-3 py-2 text-xs text-fg-2">
        <b className="text-fg">Saran sistem:</b> {advice.text}
      </p>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-5">
        <p className="max-w-sm text-xs text-fg-3">
          Perbandingan ini masih berbasis aturan (minimal {MIN_FEEDBACK_PER_GROUP} feedback per mode). Model ML akan menggantikannya setelah data cukup.
        </p>
        <Button size="sm" disabled={app.feedback.length === 0} onClick={exportCsv}>
          Ekspor data feedback
        </Button>
      </div>
    </Card>
  );
}
