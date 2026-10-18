"use client";

import { SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field } from "@/components/ui/Field";
import { FACTORY_THRESHOLDS } from "@/lib/constants";
import { fmtDateTimeLong, fmtNum, parseLocaleNumber } from "@/lib/format";
import { actions } from "@/lib/store";
import type { Jalur, Thresholds } from "@/lib/types";

type Key = Exclude<keyof Thresholds, "tempMax">; // ambang suhu hanya dari Supabase (peringatan)

const FIELDS: { key: Key; label: string; unit: string; digits: number; hint: string }[] = [
  { key: "voltMin", label: "Tegangan minimum", unit: "V", digits: 0, hint: `Bawaan ${fmtNum(FACTORY_THRESHOLDS.voltMin, 0)} V` },
  { key: "voltMax", label: "Tegangan maksimum", unit: "V", digits: 0, hint: `Bawaan ${fmtNum(FACTORY_THRESHOLDS.voltMax, 0)} V` },
  { key: "currentMax", label: "Arus maksimum", unit: "A", digits: 1, hint: `Bawaan ${fmtNum(FACTORY_THRESHOLDS.currentMax, 0)} A` },
  { key: "powerMax", label: "Daya maksimum", unit: "W", digits: 0, hint: `Bawaan ${fmtNum(FACTORY_THRESHOLDS.powerMax, 0)} W` },
  { key: "pfMin", label: "Faktor daya minimum", unit: "PF", digits: 2, hint: `Bawaan ${fmtNum(FACTORY_THRESHOLDS.pfMin, 2)}` },
  { key: "debounceSec", label: "Debounce", unit: "detik", digits: 0, hint: `Bawaan ${FACTORY_THRESHOLDS.debounceSec} detik` },
];

const toText = (th: Thresholds): Record<Key, string> =>
  Object.fromEntries(FIELDS.map((f) => [f.key, fmtNum(th[f.key], f.digits)])) as Record<Key, string>;

function validate(text: Record<Key, string>): { values: Thresholds | null; errors: Partial<Record<Key, string>> } {
  const errors: Partial<Record<Key, string>> = {};
  const v = {} as Thresholds;
  for (const f of FIELDS) {
    const n = parseLocaleNumber(text[f.key]);
    if (n == null) errors[f.key] = "Masukkan angka";
    else if (n <= 0) errors[f.key] = "Harus lebih dari 0";
    else v[f.key] = n;
  }
  if (!errors.pfMin && v.pfMin > 1) errors.pfMin = "Maksimal 1,00";
  if (!errors.debounceSec && (v.debounceSec < 1 || v.debounceSec > 60 || !Number.isInteger(v.debounceSec)))
    errors.debounceSec = "Bilangan bulat 1–60 detik";
  if (!errors.voltMin && !errors.voltMax && v.voltMin >= v.voltMax) errors.voltMin = "Harus lebih kecil dari tegangan maksimum";
  return { values: Object.keys(errors).length ? null : v, errors };
}

export function ThresholdForm({ jalur }: { jalur: Jalur }) {
  // key di pemanggil me-reset form setiap kali ambang berubah dari luar
  const [text, setText] = useState(() => toText(jalur.thresholds));
  const { values, errors } = useMemo(() => validate(text), [text]);
  const [touched, setTouched] = useState(false);

  const dirty = values != null && FIELDS.some((f) => values[f.key] !== jalur.thresholds[f.key]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!values || !dirty) return;
    actions.saveThresholds(jalur.id, values);
  };

  return (
    <Card>
      <CardHeader
        title="Pengaturan ambang"
        subtitle={`Khusus untuk Jalur ${jalur.number} · perubahan dicatat dalam log`}
        right={<SlidersHorizontal aria-hidden className="h-5 w-5 text-fg-2" />}
      />
      <form onSubmit={submit} noValidate>
        <div className="grid gap-x-4 gap-y-4 px-5 pt-5 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map((f) => (
            <Field
              key={f.key}
              label={f.label}
              suffix={f.unit}
              inputMode="decimal"
              value={text[f.key]}
              onChange={(e) => setText((t) => ({ ...t, [f.key]: e.target.value }))}
              error={touched || text[f.key] !== toText(jalur.thresholds)[f.key] ? (errors[f.key] ?? null) : null}
              hint={f.hint}
            />
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
          <p className="text-xs text-fg-3">
            Terakhir diubah oleh {jalur.thresholdsChangedBy} · {fmtDateTimeLong(jalur.thresholdsChangedAt)}
          </p>
          <Button type="submit" variant="primary" disabled={!dirty}>
            Simpan perubahan
          </Button>
        </div>
      </form>
    </Card>
  );
}
