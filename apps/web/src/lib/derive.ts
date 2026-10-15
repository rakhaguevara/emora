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
