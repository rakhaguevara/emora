import { DEFAULT_THRESHOLDS } from "../constants";
import { fmtNum } from "../format";
import type { Anomaly, AlertEvent, AppState, Interval, Jalur, Thresholds } from "../types";
import { sampleAt, startOfDay } from "./engine";

export const STORE_VERSION = 2;

const MIN = 60e3;
const HOUR = 3600e3;
const DAY = 86400e3;

const def = (over: Partial<Thresholds>): Thresholds => ({ ...DEFAULT_THRESHOLDS, ...over });

// Keadaan awal demo, relatif terhadap waktu pertama kali aplikasi dibuka.
export function seedState(now: number): AppState {
  const dayAt = (daysAgo: number, h: number, m = 0, s = 0) =>
    startOfDay(now) - daysAgo * DAY + (h * 3600 + m * 60 + s) * 1000;

  const tripAt = now - 130e3;
  const offlineAt = now - 200e3;
  const manualAt = now - (89 * 60 + 10) * 1000;
  const j3WarnAt = now - (2 * 60 + 48) * MIN;
  const yWarnAt = dayAt(1, 22, 15);
  const j2WarnAt = dayAt(3, 15, 20);
  const j4TripAt = dayAt(8, 10, 42, 19);
  const j4ManualAt = dayAt(2, 9, 12);
  const j4WarnAt = dayAt(11, 11, 5);
  const j5PfAt = dayAt(20, 20, 30);
  const cfgAt = dayAt(5, 9, 14);

  const mk = (n: number, name: string, sensorId: string, th: Thresholds, by: string, at: number): Jalur => ({
    id: `j${n}`, number: n, name, sensorId,
    relayOn: true, sensorOnline: true, offlineSince: null,
    thresholds: th, cutMode: "ask", thresholdsChangedBy: by, thresholdsChangedAt: at,
    offSnapshot: null, createdAt: now - 60 * DAY,
  });

  const jalur: Jalur[] = [
    mk(1, "Kompresor", "PZEM-03", def({ currentMax: 15, powerMax: 3500 }), "Siti Rahma", dayAt(14, 8, 30)),
    mk(2, "Pompa Air", "PZEM-01", def({}), "Dimas A.", cfgAt),
    mk(3, "Penerangan Gudang", "PZEM-02", def({ currentMax: 8, powerMax: 1800, pfMin: 0.7 }), "Dimas A.", dayAt(30, 10, 0)),
    mk(4, "Mesin Bubut", "PZEM-04", def({ currentMax: 16 }), "Raka Putra", dayAt(9, 13, 45)),
    mk(5, "HVAC Kantor", "PZEM-05", def({ currentMax: 10, powerMax: 2200 }), "Dimas A.", dayAt(30, 10, 5)),
  ];
  jalur[3] = { ...jalur[3], sensorOnline: false, offlineSince: offlineAt };

  const anomalies: Anomaly[] = [
    { jalurId: "j2", param: "current", start: tripAt - 40 * MIN, end: tripAt, peak: 18.4, shape: "ramp" },
    { jalurId: "j3", param: "pf", start: j3WarnAt, end: j3WarnAt + 18 * MIN, peak: 0.66, shape: "plateau" },
    { jalurId: "j1", param: "current", start: yWarnAt, end: yWarnAt + 6 * MIN, peak: 13.2, shape: "plateau" },
    { jalurId: "j2", param: "current", start: j2WarnAt, end: j2WarnAt + 4 * MIN, peak: 12.9, shape: "plateau" },
    { jalurId: "j4", param: "current", start: j4TripAt - 40 * MIN, end: j4TripAt, peak: 17.2, shape: "ramp" },
    { jalurId: "j4", param: "current", start: j4WarnAt, end: j4WarnAt + 5 * MIN, peak: 13.8, shape: "plateau" },
    { jalurId: "j5", param: "pf", start: j5PfAt, end: j5PfAt + 12 * MIN, peak: 0.81, shape: "plateau" },
  ];

  const offLog: Record<string, Interval[]> = {
    j2: [{ from: tripAt, to: null }],
    j4: [
      { from: j4TripAt, to: j4TripAt + 9 * MIN },
      { from: j4ManualAt, to: j4ManualAt + 14 * MIN },
    ],
    j5: [{ from: manualAt, to: null }],
  };

  const base: AppState = {
    version: STORE_VERSION,
    seededAt: now,
    facility: { name: "Pabrik Sentosa", panelName: "Panel Utama A" },
    panel: { deviceId: "EMORA-ESP32-A01", firmware: "v2.4.1", bootedAt: now - (18 * DAY + 7 * HOUR), limitW: 15000 },
    user: { name: "Andika Rahman", initials: "AR" },
    jalur,
    offLog,
    anomalies,
    events: [],
    dismissedRecs: [],
    holds: {},
    feedback: [],
  };

  const j2 = base.jalur[1];
  const tripSnap = sampleAt(base, j2, tripAt - 1, true)!;
  base.jalur[1] = { ...j2, relayOn: false, offSnapshot: tripSnap };
  const j5 = base.jalur[4];
  base.jalur[4] = { ...j5, relayOn: false, offSnapshot: sampleAt(base, j5, manualAt - 1000, true) };

  const ev = (e: Partial<AlertEvent> & Pick<AlertEvent, "id" | "jalurId" | "type" | "param" | "startedAt">): AlertEvent => {
    const j = base.jalur.find((x) => x.id === e.jalurId)!;
    return {
      jalurLabel: `Jalur ${j.number} · ${j.name}`,
      value: null, limit: null, unit: "", detail: null, note: null,
      endedAt: null, handledBy: null, acknowledged: false,
      cutSource: null, overloadSec: null, feedbackId: null,
      ...e,
    };
  };

  base.events = [
    ev({
      id: "e1", jalurId: "j2", type: "trip", param: "Arus", startedAt: tripAt,
      value: tripSnap.current, limit: 15, unit: "A", cutSource: "auto", overloadSec: 3,
      note: `Arus mencapai ${fmtNum(tripSnap.current, 1)} A, melewati batas ${fmtNum(15, 1)} A selama 3 detik. Jalur lain tetap beroperasi normal.`,
    }),
    ev({ id: "e2", jalurId: "j4", type: "offline", param: "Koneksi", startedAt: offlineAt, detail: "Tidak ada data" }),
    ev({
      id: "e3", jalurId: "j5", type: "manual", param: "Relai", startedAt: manualAt,
      detail: "OFF oleh pengguna", handledBy: "Raka Putra", acknowledged: true,
    }),
    ev({
      id: "e4", jalurId: "j3", type: "warning", param: "PF", startedAt: j3WarnAt, endedAt: j3WarnAt + 18 * MIN,
      value: 0.66, limit: 0.7, unit: "", handledBy: "Siti Rahma", acknowledged: true,
    }),
    ev({
      id: "e5", jalurId: "j1", type: "warning", param: "Arus", startedAt: yWarnAt, endedAt: yWarnAt + 6 * MIN,
      value: 13.2, limit: 15, unit: "A", handledBy: "Otomatis", acknowledged: true,
    }),
    ev({
      id: "e6", jalurId: "j4", type: "manual", param: "Relai", startedAt: j4ManualAt, endedAt: j4ManualAt + 14 * MIN,
      detail: "OFF oleh pengguna", handledBy: "Siti Rahma", acknowledged: true,
    }),
    ev({
      id: "e7", jalurId: "j2", type: "warning", param: "Arus", startedAt: j2WarnAt, endedAt: j2WarnAt + 4 * MIN,
      value: 12.9, limit: 15, unit: "A", handledBy: "Otomatis", acknowledged: true,
    }),
    ev({
      id: "e8", jalurId: "j2", type: "config", param: "Ambang", startedAt: cfgAt, endedAt: cfgAt,
      detail: "Arus maks. 16,0 → 15,0 A", handledBy: "Dimas A.", acknowledged: true,
    }),
    ev({
      id: "e9", jalurId: "j4", type: "trip", param: "Arus", startedAt: j4TripAt, endedAt: j4TripAt + 9 * MIN,
      value: 17.2, limit: 16, unit: "A", handledBy: "Raka Putra", acknowledged: true,
      cutSource: "auto", overloadSec: 3, feedbackId: "f-seed-1",
    }),
    ev({
      id: "e10", jalurId: "j4", type: "warning", param: "Arus", startedAt: j4WarnAt, endedAt: j4WarnAt + 5 * MIN,
      value: 13.8, limit: 16, unit: "A", handledBy: "Otomatis", acknowledged: true,
    }),
    ev({
      id: "e11", jalurId: "j1", type: "config", param: "Ambang", startedAt: dayAt(14, 8, 30), endedAt: dayAt(14, 8, 30),
      detail: "Debounce 5 → 3 dtk", handledBy: "Siti Rahma", acknowledged: true,
    }),
    ev({
      id: "e12", jalurId: "j5", type: "warning", param: "PF", startedAt: j5PfAt, endedAt: j5PfAt + 12 * MIN,
      value: 0.81, limit: 0.85, unit: "", handledBy: "Otomatis", acknowledged: true,
    }),
  ].sort((a, b) => b.startedAt - a.startedAt);

  base.feedback = [
    {
      id: "f-seed-1", eventId: "e9", jalurId: "j4", ts: j4TripAt + 12 * MIN, cutSource: "auto",
      outcome: "minor", timing: "right", cause: "equipment", comment: "Bearing spindel perlu dicek.",
      context: { param: "Arus", value: 17.2, limit: 16, overloadSec: 3, ratio: 17.2 / 16 },
    },
  ];

  return base;
}
