import type { Thresholds } from "./types";

// Asumsi tarif untuk perkiraan biaya (Rp/kWh). Sesuaikan dengan tarif langganan sebenarnya.
export const TARIFF_PER_KWH = 1458.5;

export const PF_TARGET = 0.85;
export const FREQ_MIN = 49.5;
export const FREQ_MAX = 50.5;
// Peringatan dini dikeluarkan saat arus/daya mencapai rasio ini dari batas trip.
export const WARN_RATIO = 0.85;

// Nilai bawaan pabrik, ditampilkan sebagai petunjuk di form ambang.
export const FACTORY_THRESHOLDS: Thresholds = {
  voltMin: 200,
  voltMax: 250,
  currentMax: 20,
  powerMax: 4000,
  pfMin: 0.8,
  debounceSec: 3,
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  voltMin: 210,
  voltMax: 240,
  currentMax: 15,
  powerMax: 3500,
  pfMin: 0.85,
  debounceSec: 3,
};

export const PARAM_META = {
  voltage: { label: "Tegangan", unit: "V", digits: 1 },
  current: { label: "Arus", unit: "A", digits: 1 },
  power: { label: "Daya", unit: "W", digits: 0 },
  pf: { label: "Faktor daya", unit: "PF", digits: 2 },
  frequency: { label: "Frekuensi", unit: "Hz", digits: 1 },
} as const;

export const EVENT_TYPE_LABEL = {
  trip: "Trip",
  warning: "Peringatan",
  offline: "Offline",
  manual: "Manual",
  config: "Konfigurasi",
} as const;

// Waktu keputusan pengguna saat beban berlebih; lewat dari ini sistem memutus sendiri (pengaman).
export const DECISION_SEC = 30;
// Beban melewati batas x rasio ini -> putus otomatis tanpa menunggu keputusan.
export const HARD_LIMIT_RATIO = 1.3;
export const MIN_FEEDBACK_PER_GROUP = 5;

export const CUT_MODE_LABEL = {
  ask: "Tanya setiap kali",
  auto: "Otomatis",
  manual: "Manual",
} as const;

export const CUT_SOURCE_LABEL = {
  auto: "Otomatis",
  manual: "Manual",
  failsafe: "Pengaman",
} as const;
