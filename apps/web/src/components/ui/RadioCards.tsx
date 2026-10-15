import { cn } from "@/lib/cn";

export interface RadioOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export function RadioCards<T extends string>({
  legend,
  name,
  value,
  onChange,
  options,
  columns = 1,
}: {
  legend: string;
  name: string;
  value: T | null;
  onChange: (v: T) => void;
  options: RadioOption<T>[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[13px] font-semibold text-fg">{legend}</legend>
      <div className={cn("grid gap-2", columns === 3 && "sm:grid-cols-3", columns === 2 && "sm:grid-cols-2")}>
        {options.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={o.value}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary",
                checked ? "border-primary bg-primary-soft" : "border-line-strong bg-surface hover:bg-surface-2",
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={checked}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                  checked ? "border-primary" : "border-line-strong",
                )}
              >
                {checked && <span className="h-2 w-2 rounded-full bg-primary" />}
              </span>
              <span>
                <span className={cn("block font-medium", checked ? "text-primary" : "text-fg")}>{o.label}</span>
                {o.hint && <span className="mt-0.5 block text-xs text-fg-3">{o.hint}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
