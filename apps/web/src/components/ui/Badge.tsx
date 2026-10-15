import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const tones = {
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  neutral: "bg-surface-2 text-fg-2 border border-line",
  primary: "bg-primary-soft text-primary",
};

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: keyof typeof tones;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
        tones[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
