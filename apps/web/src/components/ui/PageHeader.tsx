import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-[26px] leading-tight font-medium text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-fg-3">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <div className="h-8 w-48 rounded bg-line" />
      <div className="h-40 rounded-lg border border-line bg-surface" />
      <div className="h-64 rounded-lg border border-line bg-surface" />
    </div>
  );
}
