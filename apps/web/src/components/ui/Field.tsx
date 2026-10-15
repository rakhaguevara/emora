import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Field({
  label,
  hint,
  error,
  suffix,
  className,
  id,
  ...rest
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  suffix?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  const inputId = id ?? `f-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 block text-[13px] font-semibold text-fg">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={`${inputId}-note`}
          className={cn(
            "h-10 w-full rounded-md border bg-surface px-3 text-sm text-fg",
            error ? "border-danger-line" : "border-line-strong",
            suffix && "pr-12",
          )}
          {...rest}
        />
        {suffix && (
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-fg-3">
            {suffix}
          </span>
        )}
      </div>
      <p id={`${inputId}-note`} className={cn("mt-1.5 text-xs", error ? "text-danger" : "text-fg-3")}>
        {error ?? hint}
      </p>
    </div>
  );
}
