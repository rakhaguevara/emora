"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { DECISION_SEC, HARD_LIMIT_RATIO } from "@/lib/constants";
import { jalurLabel } from "@/lib/derive";
import { fmtNum } from "@/lib/format";
import { adviseCutMode } from "@/lib/ml";
import { actions, useApp, useLive } from "@/lib/store";
import { ui, useUi } from "@/lib/ui";
import type { Hold } from "@/lib/types";

const keyOf = (h: Hold) => `${h.jalurId}:${h.startedAt}`;
const fmtP = (p: Hold["param"], v: number) => (p === "current" ? `${fmtNum(v, 1)} A` : `${fmtNum(v, 0)} W`);

// Dialog keputusan saat beban berlebih + pita pengingat bila dialog ditutup.
export function OverloadHost() {
  const app = useApp();
  const live = useLive();
  const { dismissedHolds } = useUi();
  if (!app || !live) return null;

  const holds = Object.values(app.holds);
  const open = holds.find((h) => !dismissedHolds.includes(keyOf(h))) ?? null;
  const dismissed = holds.filter((h) => dismissedHolds.includes(keyOf(h)));

  return (
    <>
      {dismissed.length > 0 && (
        <div className="sticky top-16 z-20 border-b border-danger-line bg-danger-soft">
          {dismissed.map((h) => {
            const j = app.jalur.find((x) => x.id === h.jalurId);
            if (!j) return null;
            const left = Math.max(0, Math.ceil((h.deadline - live.now) / 1000));
            return (
              <div key={keyOf(h)} role="alert" className="mx-auto flex max-w-[1320px] items-center gap-3 px-4 py-2.5 text-[13px] sm:px-6">
                <AlertTriangle className="h-4 w-4 shrink-0 text-danger" />
                <span className="flex-1 text-danger">
                  <b>Beban berlebih {jalurLabel(j)}</b> menunggu keputusan · {left} dtk
                </span>
                <Button size="sm" variant="danger" onClick={() => ui.reopenHold(keyOf(h))}>
                  Tindak
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <OverloadDialog hold={open} />
    </>
  );
}

function OverloadDialog({ hold }: { hold: Hold | null }) {
  const app = useApp()!;
  const live = useLive()!;
  const [remember, setRemember] = useState(false);
  const j = hold ? app.jalur.find((x) => x.id === hold.jalurId) : null;

  return (
    <Dialog
      open={!!hold && !!j}
      onClose={() => hold && ui.dismissHold(keyOf(hold))}
      title="Beban berlebih"
      description={j ? jalurLabel(j) : undefined}
    >
      {hold && j && <Body hold={hold} remember={remember} setRemember={setRemember} live={live} app={app} />}
    </Dialog>
  );
}

function Body({
  hold, remember, setRemember, live, app,
}: {
  hold: Hold;
  remember: boolean;
  setRemember: (v: boolean) => void;
  live: NonNullable<ReturnType<typeof useLive>>;
  app: NonNullable<ReturnType<typeof useApp>>;
}) {
  const j = app.jalur.find((x) => x.id === hold.jalurId)!;
  const s = live.readings[hold.jalurId];
  const value = s ? (hold.param === "current" ? s.current : s.power) : hold.peak;
  const left = Math.max(0, Math.ceil((hold.deadline - live.now) / 1000));
  const elapsed = Math.round((live.now - hold.startedAt) / 1000) + j.thresholds.debounceSec;
  const advice = adviseCutMode(app.feedback);
  const manual = hold.choice === "manual";
  const pct = Math.min(100, Math.max(0, (left / DECISION_SEC) * 100));

  return (
    <div>
      <div className="flex items-end justify-between gap-4 rounded-md bg-danger-soft p-3.5">
        <div>
          <p className="text-xs text-danger">{hold.param === "current" ? "Arus saat ini" : "Daya saat ini"}</p>
          <p className="text-[28px] leading-none font-semibold text-danger tabular-nums">{fmtP(hold.param, value)}</p>
        </div>
        <div className="text-right text-[13px] text-danger tabular-nums">
          <p>Batas {fmtP(hold.param, hold.limit)}</p>
          <p className="font-semibold">{fmtNum((value / hold.limit) * 100, 0)}% dari batas · {elapsed} dtk</p>
        </div>
      </div>

      <div className="mt-3">
        <div className="flex justify-between text-xs text-fg-2">
          <span>Pengaman memutus otomatis dalam</span>
          <span className="font-semibold text-fg tabular-nums">{left} dtk</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-danger-solid transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-fg-3">
          Bila tidak ada keputusan, atau {hold.param === "current" ? "arus" : "daya"} melewati {fmtP(hold.param, hold.limit * HARD_LIMIT_RATIO)}, relai diputus otomatis demi keselamatan.
        </p>
      </div>

      <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-xs text-fg-2">
        <b className="text-fg">Saran sistem:</b> {advice.text}
      </p>

      {!manual ? (
        <>
          <p className="mt-4 text-sm font-medium text-fg">Bagaimana relai akan diputus?</p>
          <div className="mt-2 grid gap-2">
            <Button variant="danger" onClick={() => actions.decideOverload(hold.jalurId, "auto", remember)}>
              Putus otomatis sekarang
            </Button>
            <Button onClick={() => actions.decideOverload(hold.jalurId, "manual", remember)}>
              Saya putus manual
            </Button>
          </div>
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-[13px] text-fg-2">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary-solid)]" />
            <span>Ingat pilihan ini untuk {jalurLabel(j)}. Bisa diubah kapan saja di halaman detail jalur.</span>
          </label>
        </>
      ) : (
        <>
          <p className="mt-4 text-sm text-fg-2">
            Mode manual: relai tetap menyala sampai kamu mematikannya. Setelah itu kamu akan diminta feedback.
          </p>
          <div className="mt-3 grid gap-2">
            <Button variant="danger" onClick={() => actions.manualCut(hold.jalurId)}>
              Matikan relai sekarang
            </Button>
            <Button onClick={() => actions.decideOverload(hold.jalurId, "auto", false)}>Putus otomatis saja</Button>
            <Button variant="ghost" onClick={() => ui.dismissHold(keyOf(hold))}>
              Tutup, tetap menunggu
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
