import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cn("relative inline-block", className)}>
      <select
        className="h-10 w-full cursor-pointer appearance-none rounded-md border border-line-strong bg-surface py-0 pr-9 pl-3 text-sm text-fg"
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-fg-2"
      />
    </span>
  );
}
