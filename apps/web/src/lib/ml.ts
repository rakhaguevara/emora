import { MIN_FEEDBACK_PER_GROUP } from "./constants";
import type { Feedback, Outcome } from "./types";

// Titik sambung model ML. Saat ini baseline berbasis aturan dari data feedback:
// membandingkan dampak buruk pemutusan manual vs otomatis. Ganti isi fungsi ini dengan
// model terlatih (mis. layanan backend) tanpa mengubah komponen yang memakainya.

const OUTCOME_WEIGHT: Record<Outcome, number> = { none: 0, minor: 0.5, severe: 1 };

export interface GroupStats {
  n: number;
  none: number;
  minor: number;
  severe: number;
  adverseRate: number | null; // 0..1, severe dihitung penuh, minor setengah
}

export function groupStats(rows: Feedback[]): GroupStats {
  const n = rows.length;
  const count = (o: Outcome) => rows.filter((r) => r.outcome === o).length;
  return {
    n,
    none: count("none"),
    minor: count("minor"),
    severe: count("severe"),
    adverseRate: n ? rows.reduce((s, r) => s + OUTCOME_WEIGHT[r.outcome], 0) / n : null,
  };
}

export interface CutAdvice {
  mode: "auto" | "manual" | null;
  text: string;
  manual: GroupStats;
  auto: GroupStats;
}

export function adviseCutMode(feedback: Feedback[]): CutAdvice {
  const manual = groupStats(feedback.filter((f) => f.cutSource === "manual"));
  // pemutusan oleh pengaman juga keputusan sistem, dihitung bersama otomatis
  const auto = groupStats(feedback.filter((f) => f.cutSource !== "manual"));

  if (manual.n < MIN_FEEDBACK_PER_GROUP || auto.n < MIN_FEEDBACK_PER_GROUP) {
    return {
      mode: null,
      manual,
      auto,
      text: `Belum ada saran: butuh minimal ${MIN_FEEDBACK_PER_GROUP} feedback untuk masing-masing mode (manual ${manual.n}, otomatis ${auto.n}).`,
    };
  }
  const diff = manual.adverseRate! - auto.adverseRate!;
  if (Math.abs(diff) < 0.15) {
    return { mode: null, manual, auto, text: "Dampak pemutusan manual dan otomatis belum berbeda bermakna pada data saat ini." };
  }
  const better = diff < 0 ? "manual" : "auto";
  return {
    mode: better,
    manual,
    auto,
    text: `Pada ${manual.n + auto.n} feedback, pemutusan ${better === "manual" ? "manual" : "otomatis"} cenderung berdampak lebih ringan.`,
  };
}
