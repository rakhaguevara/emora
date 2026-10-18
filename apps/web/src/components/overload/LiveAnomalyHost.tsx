"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { isPinComplete, PinField } from "@/components/auth/PinField";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { jalurLabel } from "@/lib/derive";
import { AUTO_CUT_SEC, DECISION_SEC } from "@/lib/live/sync";
import { actions, isLive, liveMode, liveRecDeadline, liveRecs, useApp, useLive, type RecRow } from "@/lib/store";

// Mode live: pop-up saat ada anomali (nilai di luar ambang batas) dengan hitung mundur pemutusan relai.
// Keputusan dan pemutusan dijalankan backend (automation.ts); pop-up ini hanya menampilkan dan mengirim pilihan.
export function LiveAnomalyHost() {
  const app = useApp();
  const live = useLive();
  const [minimized, setMinimized] = useState<number[]>([]);
  if (!isLive || !app || !live) return null;

  const j = app.jalur[0];
  // Bila relai sudah OFF, tidak ada yang perlu diputus
  const pending = j?.relayOn ? liveRecs().filter((r) => r.status === "pending") : [];
  const open = pending.find((r) => !minimized.includes(r.id)) ?? null;
  const banners = pending.filter((r) => minimized.includes(r.id));
  const auto = liveMode() === "auto";
  const left = (r: RecRow) => Math.max(0, Math.ceil((liveRecDeadline(r) - live.now) / 1000));
  const minimize = (id: number) => setMinimized((m) => [...m, id]);

  return (
    <>
      {banners.length > 0 && (
        <div className="sticky top-16 z-20 border-b border-danger-line bg-danger-soft">
          {banners.map((r) => (
            <div key={r.id} role="alert" className="mx-auto flex max-w-[1320px] items-center gap-3 px-4 py-2.5 text-[13px] sm:px-6">
              <AlertTriangle className="h-4 w-4 shrink-0 text-danger" />
              <span className="flex-1 text-danger">
                <b>Anomali {j ? jalurLabel(j) : ""}</b> · {auto ? "putus otomatis" : "pengaman memutus"} dalam {left(r)} dtk
              </span>
              <Button size="sm" variant="danger" onClick={() => setMinimized((m) => m.filter((x) => x !== r.id))}>
                Tindak
              </Button>
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={!!open}
        onClose={() => open && minimize(open.id)}
        title={auto ? "Anomali: relai akan diputus otomatis" : "Anomali: putus relai?"}
        description={j ? jalurLabel(j) : undefined}
      >
        {open && <Body rec={open} left={left(open)} auto={auto} onDone={() => minimize(open.id)} />}
      </Dialog>
    </>
  );
}

function Body({ rec, left, auto, onDone }: { rec: RecRow; left: number; auto: boolean; onDone: () => void }) {
  const total = auto ? AUTO_CUT_SEC : DECISION_SEC;
  const reasons = (rec.reason ?? "Nilai di luar ambang batas").split("; ");
  const [pin, setPin] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = left === 0 || sending;

  // Putus atau biarkan menyala: keduanya keputusan atas listrik, jadi wajib PIN operator.
  const decide = async (op: "cut" | "ignore") => {
    if (!isPinComplete(pin)) return setError("Isi PIN 6 digit");
    setSending(true);
    setError(null);
    try {
      await (op === "cut" ? actions.cutAnomaly(rec.id, pin) : actions.ignoreAnomaly(rec.id, pin));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPin("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div role="alert" className="rounded-md border border-danger-line bg-danger-soft p-3.5">
        <ul className="space-y-1 text-[13px] font-semibold text-danger">
          {reasons.map((r) => (
            <li key={r} className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {r}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="text-fg-2">
            {left === 0 ? "Memutus relai..." : auto ? "Relai diputus otomatis dalam" : "Pengaman memutus relai dalam"}
          </span>
          {left > 0 && <span className="text-2xl font-semibold text-danger tabular-nums">{left} dtk</span>}
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-full rounded-full bg-danger-solid transition-[width] duration-1000 ease-linear" style={{ width: `${(left / total) * 100}%` }} />
        </div>
        <p className="mt-2 text-xs text-fg-3">
          {auto
            ? "Mode Otomatis. Batalkan bila beban ini memang aman tetap menyala."
            : "Mode Semi-otomatis. Bila tidak ada keputusan sampai waktu habis, pengaman memutus relai."}
        </p>
      </div>

      <div className="mt-4">
        <PinField id={`anomaly-pin-${rec.id}`} value={pin} onChange={setPin} error={error} />
      </div>

      <div className="mt-1 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => decide("ignore")}>
          {auto ? "Batalkan, biarkan menyala" : "Biarkan menyala"}
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => decide("cut")}>
          Putus relai sekarang
        </Button>
      </div>
    </div>
  );
}
