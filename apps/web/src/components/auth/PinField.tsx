"use client";

import { DEMO_PIN } from "@/lib/auth/actions";
import { isLive } from "@/lib/store";
import { Field } from "@/components/ui/Field";

export const PIN_LENGTH = 6;
export const isPinComplete = (pin: string) => pin.length === PIN_LENGTH;

// PIN kontrol operator (6 digit, dibuat admin). Wajib untuk setiap ON/OFF relai.
export function PinField({
  value,
  onChange,
  error,
  id = "control-pin",
  autoFocus,
}: {
  value: string;
  onChange: (pin: string) => void;
  error?: string | null;
  id?: string;
  autoFocus?: boolean;
}) {
  return (
    <Field
      id={id}
      label="PIN kontrol"
      type="password"
      inputMode="numeric"
      autoComplete="off"
      maxLength={PIN_LENGTH}
      autoFocus={autoFocus}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
      error={error}
      hint={isLive ? "PIN 6 digit milikmu dari admin. Salah 5 kali, kontrol dikunci 5 menit." : `Mode demo: PIN ${DEMO_PIN}`}
    />
  );
}
