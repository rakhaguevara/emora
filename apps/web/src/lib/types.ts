export type Param = "voltage" | "current" | "power" | "pf" | "frequency";

export interface Thresholds {
  voltMin: number;
  voltMax: number;
  currentMax: number;
  powerMax: number;
  pfMin: number;
  debounceSec: number;
}

export interface Sample {
  ts: number;
  voltage: number;
  current: number;
  power: number;
  pf: number | null; // null saat relai OFF (tidak ada beban)
  frequency: number;
  energyKwh: number; // energi hari ini
}

// 'ask' = tanya tiap beban berlebih; 'auto' = putus otomatis; 'manual' = putus oleh pengguna (dengan pengaman waktu)
export type CutMode = "ask" | "auto" | "manual";
// 'failsafe' = sistem memutus karena keputusan tidak diambil tepat waktu atau batas keras terlampaui
export type CutSource = "auto" | "manual" | "failsafe";

export interface Jalur {
  id: string;
  number: number;
  name: string;
  sensorId: string;
  relayOn: boolean;
  sensorOnline: boolean;
  offlineSince: number | null;
  thresholds: Thresholds;
  cutMode: CutMode;
  thresholdsChangedBy: string;
  thresholdsChangedAt: number;
  offSnapshot: Sample | null; // pembacaan terakhir sebelum relai OFF
  createdAt: number;
}

export type EventType = "trip" | "warning" | "offline" | "manual" | "config";

export interface AlertEvent {
  id: string;
  jalurId: string;
  jalurLabel: string; // cadangan bila jalur sudah dihapus
  type: EventType;
  param: string;
  value: number | null;
  limit: number | null;
  unit: string;
  detail: string | null; // menggantikan "nilai vs batas" bila tidak ada angka
  note: string | null; // penjelasan panjang (banner)
  startedAt: number;
  endedAt: number | null;
  handledBy: string | null;
  acknowledged: boolean;
  cutSource: CutSource | null; // hanya untuk event trip
  overloadSec: number | null; // lama beban berlebih sebelum relai diputus
  feedbackId: string | null;
}

export interface Interval {
  from: number;
  to: number | null;
}

// Gangguan terjadwal pada data simulasi (lonjakan arus, PF turun) agar riwayat konsisten dengan kejadian.
export interface Anomaly {
  jalurId: string;
  param: "current" | "pf";
  start: number;
  end: number;
  peak: number;
  shape: "ramp" | "plateau" | "surge";
}

// Beban berlebih yang sedang menunggu keputusan pengguna (relai masih menyala)
export interface Hold {
  jalurId: string;
  param: "current" | "power";
  startedAt: number;
  deadline: number;
  choice: "pending" | "manual";
  limit: number;
  peak: number;
  eventId: string;
}

export type Outcome = "none" | "minor" | "severe";
export type Timing = "early" | "right" | "late";
export type Cause = "load_up" | "equipment" | "surge" | "unknown";

// Satu catatan feedback pengguna: bahan evaluasi/pelatihan model ML
export interface Feedback {
  id: string;
  eventId: string;
  jalurId: string;
  ts: number;
  cutSource: CutSource;
  outcome: Outcome;
  timing: Timing;
  cause: Cause;
  comment: string;
  context: { param: string; value: number; limit: number; overloadSec: number; ratio: number };
}

export interface AppState {
  version: number;
  seededAt: number;
  facility: { name: string; panelName: string };
  panel: { deviceId: string; firmware: string; bootedAt: number };
  user: { name: string; initials: string };
  jalur: Jalur[];
  offLog: Record<string, Interval[]>;
  anomalies: Anomaly[];
  events: AlertEvent[];
  dismissedRecs: string[];
  holds: Record<string, Hold>;
  feedback: Feedback[];
}

export interface LiveState {
  now: number;
  readings: Record<string, Sample | null>;
  lastSeen: Record<string, number>;
  panelRssi: number;
}

export type JalurStatus = "normal" | "warning" | "trip" | "off" | "offline";
