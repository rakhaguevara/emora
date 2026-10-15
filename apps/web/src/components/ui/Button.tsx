import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const variants: Record<Variant, string> = {
  primary: "bg-primary-solid text-white hover:bg-primary-hover",
  secondary: "border border-line-strong bg-surface text-fg hover:bg-surface-2",
  danger: "bg-danger-solid text-white hover:bg-danger-hover",
  ghost: "text-fg-2 hover:bg-surface-2 hover:text-fg",
};
const sizes = { md: "h-10 px-4 text-sm", sm: "h-8 px-3 text-[13px]", icon: "h-10 w-10" };

interface Props {
  variant?: Variant;
  size?: keyof typeof sizes;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...rest
}: Props & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cn(base, variants[variant], sizes[size], className)} {...rest} />;
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: Props & ComponentProps<typeof Link>) {
  return <Link className={cn(base, variants[variant], sizes[size], className)} {...rest} />;
}
