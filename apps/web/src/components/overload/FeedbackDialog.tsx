"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { RadioCards } from "@/components/ui/RadioCards";
import { Select } from "@/components/ui/Select";
import { CUT_SOURCE_LABEL } from "@/lib/constants";
import { eventJalurLabel } from "@/lib/derive";
import { fmtNum } from "@/lib/format";
import { getOperator, setOperator } from "@/lib/operator";
import { actions, isLive, useApp } from "@/lib/store";
import { ui, useUi } from "@/lib/ui";
import type { AlertEvent, Cause, Outcome, Timing } from "@/lib/types";

export function FeedbackHost() {
  const app = useApp();
  const { feedbackFor } = useUi();
  const ev = app?.events.find((e) => e.id === feedbackFor) ?? null;
  return (
    <Dialog
      open={!!ev}
      onClose={ui.closeFeedback}
      title={ev ? `Feedback pemutusan ${ev.cutSource === "manual" ? "manual" : ev.cutSource === "failsafe" ? "oleh pengaman" : ev.cutSource === "local" ? "oleh proteksi ESP32" : "otomatis"}` : "Feedback"}
      description={ev && app ? summary(app, ev) : undefined}
    >
      {ev && <Form key={ev.id} ev={ev} />}
    </Dialog>
  );
}

function summary(app: NonNullable<ReturnType<typeof useApp>>, ev: AlertEvent) {
  // Pemutusan tanpa nilai terukur (mis. proteksi lokal ESP32): tampilkan alasannya
  if (ev.value == null || ev.limit == null) return `${eventJalurLabel(app, ev)} · ${ev.detail ?? ev.param}`;
  const u = ev.unit ? ` ${ev.unit}` : "";
  const d = ev.unit === "W" ? 0 : 1;
  return `${eventJalurLabel(app, ev)} · ${ev.param} ${fmtNum(ev.value ?? 0, d)}${u} / ${fmtNum(ev.limit ?? 0, d)}${u} · beban berlebih ${ev.overloadSec ?? 0} dtk`;
}

function Form({ ev }: { ev: AlertEvent }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [timing, setTiming] = useState<Timing | null>(null);
  const [cause, setCause] = useState<Cause>("unknown");
  const [comment, setComment] = useState("");
  const [name, setName] = useState(getOperator);
  const [touched, setTouched] = useState(false);
  const already = !!ev.feedbackId;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!outcome || !timing) return;
    if (isLive && !name.trim()) return;
    if (isLive) setOperator(name);
    actions.submitFeedback(ev.id, { outcome, timing, cause, comment: comment.trim().slice(0, 300) });
    ui.closeFeedback();
  };

  if (already) {
    return (
      <div>
        <p className="text-sm text-fg-2">Feedback untuk kejadian ini sudah tercatat.</p>
        <div className="mt-4 flex justify-end">
          <Button onClick={ui.closeFeedback}>Tutup</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-fg-2">
        Jawabanmu dicatat dan dipakai sistem untuk mempelajari apakah pemutusan {CUT_SOURCE_LABEL[ev.cutSource ?? "auto"].toLowerCase()} berdampak lebih baik atau lebih buruk.
      </p>
      <div>
        <RadioCards<Outcome>
          legend="Dampak setelah relai diputus"
          name="outcome"
          value={outcome}
          onChange={setOutcome}
          options={[
            { value: "none", label: "Tidak ada dampak" },
            { value: "minor", label: "Dampak ringan", hint: "Proses terhenti, perlu dinyalakan ulang" },
            { value: "severe", label: "Dampak berat", hint: "Kerusakan peralatan atau produk" },
          ]}
        />
        {touched && !outcome && <p className="mt-1 text-xs text-danger">Pilih salah satu</p>}
      </div>
      <div>
        <RadioCards<Timing>
          legend="Waktu pemutusan"
          name="timing"
          value={timing}
          onChange={setTiming}
          columns={3}
          options={[
            { value: "early", label: "Terlalu cepat" },
            { value: "right", label: "Tepat" },
            { value: "late", label: "Terlambat" },
          ]}
        />
        {touched && !timing && <p className="mt-1 text-xs text-danger">Pilih salah satu</p>}
      </div>
      {isLive && (
        <Field
          label="Nama operator"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          autoComplete="name"
          error={touched && !name.trim() ? "Isi nama operator" : null}
        />
      )}
      <div>
        <label htmlFor="fb-cause" className="mb-1.5 block text-[13px] font-semibold text-fg">Dugaan penyebab beban berlebih</label>
        <Select id="fb-cause" value={cause} onChange={(e) => setCause(e.target.value as Cause)} className="w-full">
          <option value="unknown">Belum diketahui</option>
          <option value="load_up">Beban kerja naik</option>
          <option value="equipment">Masalah peralatan</option>
          <option value="surge">Lonjakan sesaat</option>
        </Select>
      </div>
      <div>
        <label htmlFor="fb-note" className="mb-1.5 block text-[13px] font-semibold text-fg">Catatan (opsional)</label>
        <textarea
          id="fb-note"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={300}
          rows={3}
          className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-fg"
          placeholder="mis. Bearing berbunyi sebelum arus naik"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={ui.closeFeedback}>Nanti</Button>
        <Button type="submit" variant="primary">Simpan feedback</Button>
      </div>
    </form>
  );
}
