import type { AlertEvent, AppState, Jalur, JalurStatus } from "./types";

export const jalurLabel = (j: Pick<Jalur, "number" | "name">) => `Jalur ${j.number} · ${j.name}`;

export function activeEvents(app: AppState, jalurId?: string): AlertEvent[] {
  return app.events.filter((e) => e.endedAt == null && (jalurId == null || e.jalurId === jalurId));
}

export function jalurStatus(app: AppState, j: Jalur): JalurStatus {
  const active = activeEvents(app, j.id);
  if (active.some((e) => e.type === "trip")) return "trip";
  if (!j.sensorOnline) return "offline";
  if (!j.relayOn) return "off";
  if (active.some((e) => e.type === "warning")) return "warning";
  return "normal";
}

export const STATUS_LABEL: Record<JalurStatus, string> = {
  normal: "Normal",
  warning: "Peringatan",
  trip: "Trip",
  off: "Relai OFF",
  offline: "Offline",
};

export function eventJalurLabel(app: AppState, e: AlertEvent): string {
  const j = app.jalur.find((x) => x.id === e.jalurId);
  return j ? jalurLabel(j) : e.jalurLabel;
}

export function eventValueText(e: AlertEvent, fmt: (n: number, d: number) => string): string {
  if (e.detail) return e.detail;
  if (e.value == null || e.limit == null) return "—";
  const d = e.unit === "W" ? 0 : e.unit === "" ? 2 : 1;
  const u = e.unit ? ` ${e.unit}` : "";
  return `${fmt(e.value, d)}${u} / ${fmt(e.limit, d)}${u}`;
}

const REVIEW_PARAM: Record<string, string> = { Arus: "current", Daya: "power", PF: "pf", Tegangan: "voltage", Frekuensi: "frequency" };

// Tautan ke halaman detail jalur dengan grafik parameter yang bermasalah dan rentang yang mencakup waktu kejadian.
// Null bila jalur sudah dihapus atau kejadian hanya perubahan konfigurasi.
export function eventReviewHref(app: AppState, e: AlertEvent, now: number): string | null {
  const j = app.jalur.find((x) => x.id === e.jalurId);
  if (!j || e.type === "config") return null;
  const age = Math.max(0, now - e.startedAt);
  const range = age <= 3600e3 ? "1h" : age <= 86400e3 ? "24h" : age <= 7 * 86400e3 ? "7d" : "30d";
  const q = new URLSearchParams({ range });
  const param = REVIEW_PARAM[e.param];
  if (param) q.set("param", param);
  return `/jalur/${j.number}?${q}`;
}
