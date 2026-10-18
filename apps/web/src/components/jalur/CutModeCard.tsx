"use client";

import { FlaskConical, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { DECISION_SEC } from "@/lib/constants";
import { AUTO_CUT_SEC, DECISION_SEC as LIVE_DECISION_SEC } from "@/lib/live/sync";
import { actions, isLive } from "@/lib/store";
import type { CutMode, Jalur } from "@/lib/types";

const MODES: Record<CutMode, { label: string; hint: string }> = isLive
  ? {
      ask: {
        label: "Semi-otomatis",
        hint: `Sistem merekomendasikan, operator memutuskan dalam ${LIVE_DECISION_SEC} detik. Bila tidak ada keputusan, pengaman memutus relai.`,
      },
      auto: {
        label: "Otomatis",
        hint: `Relai diputus otomatis ${AUTO_CUT_SEC} detik setelah anomali terdeteksi, kecuali dibatalkan. Relai tidak bisa dinyalakan selama anomali masih aktif.`,
      },
      manual: { label: "Manual", hint: "Tidak dipakai di mode live." },
    }
  : {
      ask: { label: "Tanya setiap kali", hint: "Saat beban berlebih, operator memilih putus otomatis atau manual." },
      auto: { label: "Otomatis", hint: "Relai diputus otomatis setelah debounce. Feedback diminta sesudahnya." },
      manual: {
        label: "Manual",
        hint: `Relai menunggu operator mematikannya. Pengaman tetap memutus jika tidak ada keputusan dalam ${DECISION_SEC} detik.`,
      },
    };

// Mode pemutusan untuk operator: hanya ditampilkan. Mengubahnya di halaman Admin → Perangkat.
export function CutModeCard({ jalur, hasHold }: { jalur: Jalur; hasHold: boolean }) {
  const mode = MODES[jalur.cutMode];
  const canSimulate = jalur.relayOn && jalur.sensorOnline && !hasHold;
  const why = !jalur.sensorOnline
    ? "Sensor sedang offline."
    : !jalur.relayOn
      ? "Nyalakan relai terlebih dahulu."
      : hasHold
        ? "Beban berlebih sedang menunggu keputusan."
        : null;

  return (
    <Card className="flex flex-col">
      <CardHeader
        title={isLive ? "Pemutusan saat anomali" : "Pemutusan saat beban berlebih"}
        subtitle={
          isLive
            ? "Anomali = nilai di luar ambang batas (tegangan, arus, daya, suhu, frekuensi, PF, energi per jam)."
            : "Siapa yang memutus relai saat beban berlebih."
        }
      />
      <div className="px-5 pt-4">
        <div className="rounded-md border border-line bg-surface-2 p-3.5">
          <p className="flex items-center justify-between gap-2 text-[15px] font-semibold text-fg">
            {mode.label}
            <span className="inline-flex items-center gap-1 text-xs font-medium text-fg-3">
              <Lock className="h-3.5 w-3.5" /> Diatur admin
            </span>
          </p>
          <p className="mt-1 text-[13px] text-fg-2">{mode.hint}</p>
        </div>
      </div>
      {isLive ? <div className="mb-5" /> : (
      <div className="mx-5 mt-5 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-line-strong p-3.5">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-fg">
            <FlaskConical className="h-4 w-4 text-fg-3" /> Alat demo
          </p>
          <p className="mt-0.5 text-xs text-fg-3">
            {why ?? "Memicu lonjakan arus 120% dari batas selama 90 detik untuk mencoba alur ini."}
          </p>
        </div>
        <Button size="sm" disabled={!canSimulate} onClick={() => actions.simulateOverload(jalur.id)}>
          Simulasikan beban berlebih
        </Button>
      </div>
      )}
    </Card>
  );
}
