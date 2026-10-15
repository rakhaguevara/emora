import type { Jalur } from "@/lib/types";

// Warna mengikuti jalur (bukan urutan tampil): jalur 1–5 memakai ramp biru ordinal,
// jalur lain digabung menjadi satu seri "Lainnya".
export const OTHER_KEY = "other";

export function colorFor(number: number): string {
  return number >= 1 && number <= 5 ? `var(--chart-${number})` : "var(--axis)";
}

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  jalurIds: string[];
}

export function seriesDefs(jalur: Jalur[]): SeriesDef[] {
  const main = jalur
    .filter((j) => j.number <= 5)
    .sort((a, b) => a.number - b.number)
    .map((j) => ({ key: j.id, label: `Jalur ${j.number}`, color: colorFor(j.number), jalurIds: [j.id] }));
  const rest = jalur.filter((j) => j.number > 5);
  if (rest.length) main.push({ key: OTHER_KEY, label: "Lainnya", color: colorFor(99), jalurIds: rest.map((j) => j.id) });
  return main;
}
