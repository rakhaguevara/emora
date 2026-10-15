"use client";

import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { dismissToast, useToasts } from "@/lib/toast";
import { cn } from "@/lib/cn";

const icon = {
  success: <CheckCircle2 className="h-4 w-4 text-success" />,
  error: <XCircle className="h-4 w-4 text-danger" />,
  info: <Info className="h-4 w-4 text-primary" />,
};

export function ToastHost() {
  const toasts = useToasts();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 lg:bottom-4 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex items-start gap-3 rounded-md border border-line bg-surface px-3.5 py-3 text-sm text-fg shadow-[var(--shadow)]",
          )}
        >
          <span className="mt-0.5">{icon[t.tone]}</span>
          <span className="flex-1">
            {t.message}
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.onClick();
                  dismissToast(t.id);
                }}
                className="mt-1.5 block font-semibold text-primary hover:underline"
              >
                {t.action.label}
              </button>
            )}
          </span>
          <button type="button" aria-label="Tutup" onClick={() => dismissToast(t.id)} className="text-fg-3 hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
