"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { isPinComplete, PinField } from "@/components/auth/PinField";
import { Select } from "@/components/ui/Select";
import { jalurLabel } from "@/lib/derive";
import { blockingAnomalies } from "@/lib/live/sync";
import { actions, isLive, liveMode } from "@/lib/store";
import type { Jalur } from "@/lib/types";

const REASONS: Record<"on" | "off", string[]> = {
  off: ["Perawatan / pemeriksaan", "Kondisi tidak aman", "Mengikuti rekomendasi sistem", "Beban tidak digunakan", "Uji coba"],
  on: ["Pemeriksaan selesai, kondisi aman", "Beban dibutuhkan untuk operasi", "Uji coba"],
};
const OTHER = "Lainnya";

export type RelayAction = "on" | "off";

// Konfirmasi ON/OFF relai oleh operator: wajib alasan dan PIN kontrol. Pelaku dicatat backend dari sesi login.
export function ConfirmRelay({ jalur, action, onClose }: { jalur: Jalur | null; action: RelayAction | null; onClose: () => void }) {
  const open = !!jalur && !!action;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={action === "on" ? "Nyalakan relai?" : "Matikan relai?"}
      description={
        jalur
          ? action === "on"
            ? `Beban pada ${jalurLabel(jalur)} akan kembali terhubung.`
            : `Beban pada ${jalurLabel(jalur)} akan terputus. Tindakan ini dicatat sebagai kejadian Manual.`
          : undefined
      }
    >
      {open && <Form key={`${jalur.id}-${action}`} jalur={jalur} action={action} onClose={onClose} />}
    </Dialog>
  );
}

function Form({ jalur, action, onClose }: { jalur: Jalur; action: RelayAction; onClose: () => void }) {
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const [pin, setPin] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Mode otomatis: ON ditolak selama anomali masih aktif (backend juga menolak)
  const blocking = isLive && action === "on" && liveMode() === "auto" ? blockingAnomalies() : [];
  const reason = [choice === OTHER ? "" : choice, note.trim()].filter(Boolean).join(" · ");
  const reasonErr = isLive && touched && !reason ? (choice === OTHER ? "Tulis alasannya di catatan" : "Pilih alasan") : null;
  const pinErr = submitError ?? (touched && !isPinComplete(pin) ? "Isi PIN 6 digit" : null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setSubmitError(null);
    if (blocking.length || (isLive && !reason) || !isPinComplete(pin)) return;
    setBusy(true);
    try {
      await actions.setRelay(jalur.id, action === "on", reason.slice(0, 300), pin);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {blocking.length > 0 && (
        <p role="alert" className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger">
          Mode otomatis: relai tidak bisa dinyalakan selama anomali {blocking.join(", ").toLowerCase()} masih aktif.
          Tunggu sampai nilai kembali normal.
        </p>
      )}
      {isLive && (
        <>
          <div>
            <label htmlFor="relay-reason" className="mb-1.5 block text-[13px] font-semibold text-fg">Alasan</label>
            <Select id="relay-reason" value={choice} onChange={(e) => setChoice(e.target.value)} className="w-full">
              <option value="" disabled>Pilih alasan</option>
              {[...REASONS[action], OTHER].map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor="relay-note" className="mb-1.5 block text-[13px] font-semibold text-fg">
              Catatan {choice === OTHER ? "" : "(opsional)"}
            </label>
            <textarea
              id="relay-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
              rows={2}
              className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-fg"
              placeholder={action === "off" ? "mis. Ganti kabel beban" : "mis. Kabel sudah diganti"}
            />
            {reasonErr && <p className="mt-1 text-xs text-danger">{reasonErr}</p>}
          </div>
        </>
      )}
      <PinField value={pin} onChange={setPin} error={pinErr} autoFocus={!isLive} />
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Batal</Button>
        <Button type="submit" variant={action === "off" ? "danger" : "primary"} disabled={blocking.length > 0 || busy}>
          {busy ? "Mengirim..." : action === "on" ? "Nyalakan relai" : "Matikan relai"}
        </Button>
      </div>
    </form>
  );
}
