"use client";

import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { RadioCards } from "@/components/ui/RadioCards";
import { DECISION_SEC } from "@/lib/constants";
import { actions } from "@/lib/store";
import type { CutMode, Jalur } from "@/lib/types";

export function CutModeCard({ jalur, hasHold }: { jalur: Jalur; hasHold: boolean }) {
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
        title="Pemutusan saat beban berlebih"
        subtitle="Pilih siapa yang memutus relai. Bisa diubah kapan saja."
      />
      <div className="px-5 pt-4">
        <RadioCards<CutMode>
          legend="Mode pemutusan"
          name={`cutmode-${jalur.id}`}
          value={jalur.cutMode}
          onChange={(m) => actions.setCutMode(jalur.id, m)}
          options={[
            { value: "ask", label: "Tanya setiap kali", hint: "Saat beban berlebih, kamu memilih putus otomatis atau manual." },
            { value: "auto", label: "Otomatis", hint: "Relai diputus otomatis setelah debounce. Feedback diminta sesudahnya." },
            {
              value: "manual",
              label: "Manual",
              hint: `Relai menunggu kamu mematikannya. Pengaman tetap memutus jika tidak ada keputusan dalam ${DECISION_SEC} detik.`,
            },
          ]}
        />
      </div>
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
    </Card>
  );
}
