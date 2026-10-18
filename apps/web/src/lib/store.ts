"use client";

import { useSyncExternalStore } from "react";
import { CUT_MODE_LABEL, DECISION_SEC, DEFAULT_THRESHOLDS, HARD_LIMIT_RATIO, WARN_RATIO } from "./constants";
import { activeEvents, jalurLabel } from "./derive";
import { fmtNum } from "./format";
import { notifyChanges, vibrate } from "./live/notify";
import {
  ackLive, blockingAnomalies, buildLiveApp, isLiveOnline, latestEnv, clearLive, dismissRec, executeRec, getCommand, getLinkStatus, getMode, getRecs, recDeadline,
  sendFeedback, sendRelayCommand, setDeviceMode, isSensorOk, isSynced, latestLive, LIVE_ENABLED, liveStatusKey, startLiveSync,
  type LinkStatus,
} from "./live/sync";
import { energyKwhBetween, sampleAt, startOfDay } from "./sim/engine";
import { seedState, STORE_VERSION } from "./sim/seed";
import { toast } from "./toast";
import { ui } from "./ui";
import type { AlertEvent, AppState, Cause, CutMode, CutSource, Feedback, Hold, Jalur, LiveState, Outcome, Sample, Thresholds, Timing } from "./types";

// Dua mode:
// - Demo (bawaan): semua data disimulasikan dan disimpan di localStorage.
// - Live (bila kunci Supabase diisi di .env.local): satu jalur dari ESP32, data dibaca dari Supabase
//   (lihat live/sync.ts). Tindakan yang belum didukung firmware/backend hanya menampilkan pemberitahuan.
export const isLive = LIVE_ENABLED;
export const liveLinkStatus = (): LinkStatus => getLinkStatus();
export const liveMode = getMode;
export const liveRecs = getRecs;
export const liveRecDeadline = recDeadline;
export type { RecRow } from "./live/sync";

// Status rekomendasi yang terakhir dilihat, untuk memberi tahu saat berubah (diputus / normal kembali)
const recSeen = new Map<number, string>();
let recPrimed = false;
// Rekomendasi yang diputus lewat tombol "Putus sekarang" (bukan otomatis/pengaman)
const userExecuted = new Set<number>();

function watchRecs() {
  for (const r of getRecs()) {
    const prev = recSeen.get(r.id);
    recSeen.set(r.id, r.status);
    if (!recPrimed || prev === r.status || prev !== "pending") continue;
    const evId = `rec${r.id}`;
    if (r.status === "executed" && userExecuted.has(r.id)) {
      ui.openFeedback(evId); // operator memutus sendiri: langsung minta feedback
    } else if (r.status === "executed") {
      const ev = app?.events.find((e) => e.id === evId);
      const by = ev?.cutSource === "local" ? "oleh proteksi lokal ESP32" : ev?.cutSource === "failsafe" ? "oleh pengaman" : "otomatis";
      toast(`Relai diputus ${by}: ${r.reason ?? "anomali"}`, "error", { label: "Beri feedback", onClick: () => ui.openFeedback(evId) }, 0);
      vibrate([200, 100, 200]);
    } else if (r.status === "expired") {
      toast("Nilai kembali normal sebelum waktu habis, relai tidak diputus", "success");
    }
  }
  recPrimed = true;
}

// Pemutusan oleh proteksi lokal ESP32 tanpa rekomendasi (mis. batas kritis, backend tak terjangkau)
const localSeen = new Set<string>();
let localPrimed = false;
function watchLocalTrips(events: AlertEvent[]) {
  for (const e of events) {
    if (!e.id.startsWith("local") || localSeen.has(e.id)) continue;
    localSeen.add(e.id);
    if (!localPrimed) continue;
    toast(`Relai diputus proteksi lokal ESP32: ${e.detail ?? "batas kritis"}`, "error", { label: "Beri feedback", onClick: () => ui.openFeedback(e.id) }, 0);
    vibrate([200, 100, 200]);
  }
  localPrimed = true;
}

let lastStatusKey = "";

// Perintah relai yang menunggu konfirmasi ESP32 (dipantau tiap detik oleh tick)
let pendingCmd: { id: number; action: "on" | "off"; at: number } | null = null;
const CMD_TIMEOUT_MS = 15_000;

function watchCommand(now: number) {
  if (!pendingCmd) return;
  const c = getCommand(pendingCmd.id);
  const what = pendingCmd.action === "on" ? "ON" : "OFF";
  if (c?.status === "acked") {
    toast(`Relai ${what}: dikonfirmasi ESP32`, "success");
    pendingCmd = null;
  } else if (c?.status === "failed") {
    toast(`Relai ${what} gagal diterapkan ESP32`, "error");
    pendingCmd = null;
  } else if (now - pendingCmd.at > CMD_TIMEOUT_MS) {
    toast(
      `ESP32 belum mengonfirmasi relai ${what} setelah ${CMD_TIMEOUT_MS / 1000} detik. Pastikan ESP32 menyala, tersambung WiFi, dan memakai firmware terbaru. Perintah tetap tersimpan dan diterapkan saat ESP32 tersambung.`,
      "error", undefined, 0,
    );
    pendingCmd = null;
  }
}

// Mode live: susun ulang state dari data Supabase dan munculkan pop-up untuk masalah baru.
function rebuildLive(now = Date.now()) {
  app = buildLiveApp(app, now);
  watchCommand(now);
  if (isSynced()) {
    watchRecs();
    watchLocalTrips(app.events);
  }
  lastStatusKey = liveStatusKey(now);
  if (isSynced()) notifyChanges(app.events, app.jalur[0]?.relayOn ?? false);
  appListeners.forEach((l) => l());
}

const KEY = "emora.demo.v2";

let app: AppState | null = null;
let live: LiveState | null = null;
const appListeners = new Set<() => void>();
const liveListeners = new Set<() => void>();
let started = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

// Pewaktu runtime (tidak disimpan)
const overSince: Record<string, number | undefined> = {};
const condSince: Record<string, number | undefined> = {};
const clearSince: Record<string, number | undefined> = {};
const HOLD_MS = 10_000;
let evSeq = 0;

function flush() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (!app) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(app));
  } catch {
    /* penyimpanan penuh / diblokir: abaikan */
  }
}

function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(flush, 200);
}

function setApp(fn: (s: AppState) => AppState) {
  app = fn(app!);
  appListeners.forEach((l) => l());
  persist();
}

function newEventId() {
  return `e${Date.now().toString(36)}${(evSeq++).toString(36)}`;
}

function makeEvent(j: Jalur, p: Partial<AlertEvent> & Pick<AlertEvent, "type" | "param" | "startedAt">): AlertEvent {
  return {
    id: newEventId(),
    jalurId: j.id,
    jalurLabel: jalurLabel(j),
    value: null, limit: null, unit: "", detail: null, note: null,
    endedAt: null, handledBy: null, acknowledged: false,
    cutSource: null, overloadSec: null, feedbackId: null,
    ...p,
  };
}

function computeLive(now: number, prev?: LiveState): LiveState {
  if (LIVE_ENABLED) {
    const latest = latestLive();
    const readings: LiveState["readings"] = {};
    const lastSeen: LiveState["lastSeen"] = {};
    for (const j of app!.jalur) {
      readings[j.id] =
        latest && isSensorOk(now) ? { ...latest, energyKwh: energyKwhBetween(app!, j, startOfDay(now), now) } : null;
      lastSeen[j.id] = latest?.ts ?? now;
    }
    return { now, readings, lastSeen, panelRssi: prev?.panelRssi ?? 0, env: isLiveOnline(now) ? latestEnv() : null };
  }
  const readings: LiveState["readings"] = {};
  const lastSeen: LiveState["lastSeen"] = { ...(prev?.lastSeen ?? {}) };
  for (const j of app!.jalur) {
    if (!j.sensorOnline) {
      readings[j.id] = null;
      lastSeen[j.id] = j.offlineSince ?? now;
      continue;
    }
    readings[j.id] = sampleAt(app!, j, now, true);
    lastSeen[j.id] = now;
  }
  const rssi = Math.round(-58 + 3 * Math.sin(now / 90_000));
  return { now, readings, lastSeen, panelRssi: rssi };
}

// ---- Mesin aturan (dijalankan tiap detik) ----

const holdKey = (h: Hold) => `${h.jalurId}:${h.startedAt}`;

function paramName(p: "current" | "power") {
  return p === "current" ? "Arus" : "Daya";
}

function fmtParam(p: "current" | "power", v: number) {
  return p === "current" ? `${fmtNum(v, 1)} A` : `${fmtNum(v, 0)} W`;
}

function evaluate(now: number, readings: LiveState["readings"]) {
  for (const j of app!.jalur) {
    const s = readings[j.id];
    const th = j.thresholds;

    if (!j.relayOn) {
      overSince[j.id] = undefined;
      if (app!.holds[j.id]) dropHold(j.id); // relai dimatikan lewat saklar saat menunggu keputusan
      continue;
    }

    const over = s ? (s.current > th.currentMax ? "current" : s.power > th.powerMax ? "power" : null) : null;
    if (over && s) {
      overSince[j.id] ??= now;
      if (!app!.holds[j.id] && now - overSince[j.id]! >= th.debounceSec * 1000) {
        if (j.cutMode === "auto") {
          tripJalur(j.id, over, s, now, "auto", th.debounceSec);
          overSince[j.id] = undefined;
          continue;
        }
        startHold(j.id, over, s, now);
      }
    } else {
      overSince[j.id] = undefined;
    }

    const h = app!.holds[j.id];
    if (h) {
      const value = s ? (h.param === "current" ? s.current : s.power) : null;
      if (value != null && value > h.peak) {
        setApp((st) => ({ ...st, holds: { ...st.holds, [j.id]: { ...st.holds[j.id], peak: value } } }));
      }
      const hard = h.limit * HARD_LIMIT_RATIO;
      if (now >= h.deadline || (value != null && value >= hard)) {
        tripJalur(j.id, h.param, s, now, "failsafe", Math.round((now - h.startedAt) / 1000) + th.debounceSec);
        continue;
      }
      const hk = `hold:${holdKey(h)}`;
      if (!over) {
        clearSince[hk] ??= now;
        if (now - clearSince[hk]! >= 5000) {
          clearSince[hk] = undefined;
          resolveHold(j.id);
        }
      } else {
        clearSince[hk] = undefined;
      }
    }

    if (!s) continue;
    const conds: { key: string; param: string; hit: boolean; value: number; limit: number; unit: string }[] = [
      { key: "current", param: "Arus", hit: s.current >= th.currentMax * WARN_RATIO, value: s.current, limit: th.currentMax, unit: "A" },
      { key: "power", param: "Daya", hit: s.power >= th.powerMax * WARN_RATIO, value: s.power, limit: th.powerMax, unit: "W" },
      { key: "pf", param: "PF", hit: s.pf != null && s.power >= th.powerMax * 0.1 && s.pf < th.pfMin, value: s.pf ?? 0, limit: th.pfMin, unit: "" },
      { key: "volt", param: "Tegangan", hit: s.voltage < th.voltMin || s.voltage > th.voltMax, value: s.voltage, limit: s.voltage < th.voltMin ? th.voltMin : th.voltMax, unit: "V" },
    ];
    for (const c of conds) {
      const k = `${j.id}:${c.key}`;
      const open = app!.events.find((e) => e.jalurId === j.id && e.type === "warning" && e.param === c.param && e.endedAt == null);
      if (c.hit) {
        clearSince[k] = undefined;
        condSince[k] ??= now;
        if (!open && now - condSince[k]! >= HOLD_MS) {
          const ev = makeEvent(j, { type: "warning", param: c.param, startedAt: now, value: c.value, limit: c.limit, unit: c.unit });
          setApp((st) => ({ ...st, events: [ev, ...st.events] }));
        }
      } else {
        condSince[k] = undefined;
        if (open) {
          clearSince[k] ??= now;
          if (now - clearSince[k]! >= HOLD_MS) {
            clearSince[k] = undefined;
            setApp((st) => ({
              ...st,
              events: st.events.map((e) => (e.id === open.id ? { ...e, endedAt: now, handledBy: "Otomatis", acknowledged: true } : e)),
            }));
          }
        }
      }
    }
  }
}

function startHold(jalurId: string, param: "current" | "power", s: Sample, now: number) {
  const j = app!.jalur.find((x) => x.id === jalurId);
  if (!j) return;
  const value = param === "current" ? s.current : s.power;
  const limit = param === "current" ? j.thresholds.currentMax : j.thresholds.powerMax;
  const unit = param === "current" ? "A" : "W";
  const ev = makeEvent(j, {
    type: "warning", param: paramName(param), startedAt: now, value, limit, unit,
    note: "Beban berlebih, menunggu keputusan pengguna.",
  });
  const hold: Hold = {
    jalurId, param, startedAt: now, deadline: now + DECISION_SEC * 1000,
    choice: j.cutMode === "manual" ? "manual" : "pending", limit, peak: value, eventId: ev.id,
  };
  setApp((st) => ({
    ...st,
    holds: { ...st.holds, [jalurId]: hold },
    events: [ev, ...st.events.filter((e) => !(e.jalurId === jalurId && e.type === "warning" && e.param === ev.param && e.endedAt == null))],
  }));
}

function dropHold(jalurId: string) {
  const h = app!.holds[jalurId];
  if (!h) return;
  const now = Date.now();
  setApp((st) => {
    const { [jalurId]: _removed, ...rest } = st.holds;
    void _removed;
    return {
      ...st,
      holds: rest,
      events: st.events.map((e) => (e.id === h.eventId && e.endedAt == null ? { ...e, endedAt: now, handledBy: st.user.name, acknowledged: true } : e)),
    };
  });
}

function resolveHold(jalurId: string) {
  const h = app!.holds[jalurId];
  if (!h) return;
  const now = Date.now();
  setApp((st) => {
    const { [jalurId]: _removed, ...rest } = st.holds;
    void _removed;
    return {
      ...st,
      holds: rest,
      events: st.events.map((e) =>
        e.id === h.eventId ? { ...e, endedAt: now, handledBy: "Otomatis", acknowledged: true, note: "Beban kembali normal sebelum relai diputus." } : e,
      ),
    };
  });
  const j = app!.jalur.find((x) => x.id === jalurId);
  if (j) toast(`Beban ${jalurLabel(j)} kembali normal, relai tidak diputus`, "success");
}

function tripJalur(jalurId: string, param: "current" | "power", s: Sample | null, now: number, source: CutSource, overloadSec: number) {
  const j = app!.jalur.find((x) => x.id === jalurId);
  if (!j) return;
  const h = app!.holds[jalurId];
  const value = s ? (param === "current" ? s.current : s.power) : (h?.peak ?? 0);
  const limit = param === "current" ? j.thresholds.currentMax : j.thresholds.powerMax;
  const unit = param === "current" ? "A" : "W";
  const name = paramName(param);
  const reach = `${name} mencapai ${fmtParam(param, value)}, melewati batas ${fmtParam(param, limit)} selama ${overloadSec} detik.`;
  const note =
    source === "manual" ? `${reach} Relai dimatikan manual oleh ${app!.user.name}.`
    : source === "failsafe"
      ? `${reach} Pengaman memutus relai karena keputusan tidak diambil dalam ${DECISION_SEC} detik atau beban melewati batas keras.`
      : `${reach} Jalur lain tetap beroperasi normal.`;
  const ev = makeEvent(j, {
    type: "trip", param: name, startedAt: now, value, limit, unit, note,
    cutSource: source, overloadSec,
    handledBy: source === "manual" ? app!.user.name : null,
    acknowledged: source === "manual",
  });
  setApp((st) => {
    const { [jalurId]: _removed, ...holds } = st.holds;
    void _removed;
    return {
      ...st,
      holds,
      jalur: st.jalur.map((x) => (x.id === jalurId ? { ...x, relayOn: false, offSnapshot: s ?? x.offSnapshot } : x)),
      offLog: { ...st.offLog, [jalurId]: [...(st.offLog[jalurId] ?? []), { from: now, to: null }] },
      events: [
        ev,
        ...st.events.map((e) =>
          e.jalurId === jalurId && e.type === "warning" && e.endedAt == null && (e.param === "Arus" || e.param === "Daya")
            ? { ...e, endedAt: now, handledBy: source === "manual" ? st.user.name : "Otomatis", acknowledged: true }
            : e,
        ),
      ],
    };
  });
  if (source === "manual") {
    toast(`Relai ${jalurLabel(j)} dimatikan`, "info");
    ui.openFeedback(ev.id);
  } else {
    toast(
      `Relai ${jalurLabel(j)} diputus ${source === "failsafe" ? "oleh pengaman" : "otomatis"}: ${name.toLowerCase()} berlebih`,
      "error",
      { label: "Beri feedback", onClick: () => ui.openFeedback(ev.id) },
    );
  }
}

function tick() {
  const now = Date.now();
  if (LIVE_ENABLED) {
    // Status online berubah karena waktu berjalan, bukan karena data baru: bangun ulang state.
    if (liveStatusKey(now) !== lastStatusKey) rebuildLive(now);
    else watchCommand(now);
  }
  live = computeLive(now, live ?? undefined);
  if (!LIVE_ENABLED) evaluate(now, live.readings);
  liveListeners.forEach((l) => l());
}

function init() {
  if (started || typeof window === "undefined") return;
  started = true;
  if (LIVE_ENABLED) {
    app = buildLiveApp(null, Date.now());
    live = computeLive(Date.now());
    startLiveSync(
      () => {
        rebuildLive();
        live = computeLive(Date.now(), live ?? undefined);
        liveListeners.forEach((l) => l());
      },
      (msg) => toast(`Gagal membaca Supabase: ${msg}`, "error"),
    );
    setInterval(tick, 1000);
    return;
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed?.version === STORE_VERSION) {
        app = parsed;
        app.panel.limitW ??= 15000; // state lama sebelum ada batas daya panel
      }
    }
  } catch {
    /* data rusak: seed ulang */
  }
  if (!app) app = seedState(Date.now());
  live = computeLive(Date.now());
  appListeners.forEach((l) => l());
  liveListeners.forEach((l) => l());
  setInterval(tick, 1000);
  // Pastikan perubahan terakhir tersimpan sebelum halaman ditutup / dimuat ulang
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  // Sinkronkan antar tab
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue) as AppState;
      if (parsed.version === STORE_VERSION) {
        app = parsed;
        appListeners.forEach((l) => l());
      }
    } catch {
      /* abaikan */
    }
  });
}

function subscribe(set: Set<() => void>) {
  return (cb: () => void) => {
    set.add(cb);
    init();
    return () => set.delete(cb);
  };
}
const subApp = subscribe(appListeners);
const subLive = subscribe(liveListeners);

export function useApp(): AppState | null {
  return useSyncExternalStore(subApp, () => app, () => null);
}
export function useLive(): LiveState | null {
  return useSyncExternalStore(subLive, () => live, () => null);
}

// ---- Tindakan ----

const userName = () => app!.user.name;

// Mode live: tindakan yang butuh perintah ke ESP32 atau penulisan ke Supabase belum tersedia.
function liveBlocked(what: string): boolean {
  if (!LIVE_ENABLED) return false;
  toast(`${what} belum tersedia di mode live: firmware dan backend belum mendukung perintah dari dashboard`, "info");
  return true;
}

export const actions = {
  // reason: alasan operator (wajib di mode live, dicatat di relay_commands)
  setRelay(jalurId: string, on: boolean, reason = "") {
    if (LIVE_ENABLED) {
      const action = on ? "on" : "off";
      // Backend juga menolak perintah ini; dicek di sini agar tidak mengirim perintah yang pasti gagal.
      const blocking = on && getMode() === "auto" ? blockingAnomalies() : [];
      if (blocking.length) {
        toast(`Mode otomatis: relai tidak bisa dinyalakan selama anomali ${blocking.join(", ").toLowerCase()} masih aktif`, "error");
        return;
      }
      toast(`Mengirim perintah relai ${on ? "ON" : "OFF"} ke ESP32...`, "info");
      sendRelayCommand(action, reason)
        .then((c) => {
          pendingCmd = { id: c.id, action, at: Date.now() };
          rebuildLive();
        })
        .catch((err: Error) => toast(`Perintah relai gagal: ${err.message}`, "error", undefined, 0));
      return;
    }
    const j = app!.jalur.find((x) => x.id === jalurId);
    if (!j || j.relayOn === on) return;
    // Mematikan saat beban berlebih menunggu keputusan = pemutusan manual (minta feedback)
    if (!on && app!.holds[jalurId]) return actions.manualCut(jalurId);
    const now = Date.now();
    if (on) {
      setApp((st) => ({
        ...st,
        jalur: st.jalur.map((x) => (x.id === jalurId ? { ...x, relayOn: true } : x)),
        offLog: {
          ...st.offLog,
          [jalurId]: (st.offLog[jalurId] ?? []).map((i) => (i.to == null ? { ...i, to: now } : i)),
        },
        events: st.events.map((e) =>
          e.jalurId === jalurId && e.endedAt == null && (e.type === "trip" || e.type === "manual")
            ? { ...e, endedAt: now, handledBy: e.handledBy ?? st.user.name, acknowledged: true }
            : e,
        ),
      }));
      toast(`Relai ${jalurLabel(j)} dinyalakan`, "success");
    } else {
      const snap = live?.readings[jalurId] ?? null;
      const ev = makeEvent(j, {
        type: "manual", param: "Relai", startedAt: now, detail: "OFF oleh pengguna",
        handledBy: userName(), acknowledged: true,
      });
      setApp((st) => ({
        ...st,
        jalur: st.jalur.map((x) => (x.id === jalurId ? { ...x, relayOn: false, offSnapshot: snap } : x)),
        offLog: { ...st.offLog, [jalurId]: [...(st.offLog[jalurId] ?? []), { from: now, to: null }] },
        events: [ev, ...st.events],
      }));
      toast(`Relai ${jalurLabel(j)} dimatikan`, "info");
    }
  },

  setCutMode(jalurId: string, mode: CutMode) {
    if (LIVE_ENABLED) {
      const m = mode === "auto" ? "auto" : "semi_auto";
      if (getMode() === m) return;
      setDeviceMode(m)
        .then(() => {
          rebuildLive();
          toast(`Mode pemutusan: ${m === "auto" ? "Otomatis" : "Semi-otomatis"}`, "success");
        })
        .catch((err: Error) => toast(`Gagal mengubah mode: ${err.message}`, "error", undefined, 0));
      return;
    }
    const j = app!.jalur.find((x) => x.id === jalurId);
    if (!j || j.cutMode === mode) return;
    const now = Date.now();
    const ev = makeEvent(j, {
      type: "config", param: "Mode pemutusan", startedAt: now, endedAt: now,
      detail: `${CUT_MODE_LABEL[j.cutMode]} → ${CUT_MODE_LABEL[mode]}`, handledBy: userName(), acknowledged: true,
    });
    setApp((st) => ({
      ...st,
      jalur: st.jalur.map((x) => (x.id === jalurId ? { ...x, cutMode: mode } : x)),
      holds: st.holds[jalurId] && mode === "manual" ? { ...st.holds, [jalurId]: { ...st.holds[jalurId], choice: "manual" } } : st.holds,
      events: [ev, ...st.events],
    }));
    toast(`Mode pemutusan ${jalurLabel(j)}: ${CUT_MODE_LABEL[mode]}`, "success");
    const h = app!.holds[jalurId];
    const s = live?.readings[jalurId];
    if (mode === "auto" && h && s) tripJalur(jalurId, h.param, s, Date.now(), "auto", Math.round((Date.now() - h.startedAt) / 1000) + j.thresholds.debounceSec);
  },

  // Keputusan pengguna saat beban berlebih: putus otomatis atau tangani manual.
  decideOverload(jalurId: string, choice: "auto" | "manual", remember: boolean) {
    if (liveBlocked("Pemutusan relai")) return;
    const h = app!.holds[jalurId];
    const j = app!.jalur.find((x) => x.id === jalurId);
    if (!h || !j) return;
    if (remember) actions.setCutMode(jalurId, choice);
    const hh = app!.holds[jalurId];
    if (!hh) return; // sudah diputus oleh setCutMode('auto')
    if (choice === "auto") {
      const s = live?.readings[jalurId];
      tripJalur(jalurId, hh.param, s ?? null, Date.now(), "auto", Math.round((Date.now() - hh.startedAt) / 1000) + j.thresholds.debounceSec);
    } else {
      setApp((st) => ({ ...st, holds: { ...st.holds, [jalurId]: { ...st.holds[jalurId], choice: "manual" } } }));
    }
  },

  // Mode live: tombol pada pop-up anomali
  cutAnomaly(id: number) {
    sendRec(id, "execute");
  },
  ignoreAnomaly(id: number) {
    sendRec(id, "dismiss");
  },

  // Pengguna mematikan relai sendiri sebagai respons beban berlebih -> minta feedback.
  manualCut(jalurId: string) {
    if (liveBlocked("Pemutusan relai")) return;
    const h = app!.holds[jalurId];
    const j = app!.jalur.find((x) => x.id === jalurId);
    if (!h || !j) return;
    const s = live?.readings[jalurId];
    tripJalur(jalurId, h.param, s ?? null, Date.now(), "manual", Math.round((Date.now() - h.startedAt) / 1000) + j.thresholds.debounceSec);
  },

  submitFeedback(eventId: string, d: { outcome: Outcome; timing: Timing; cause: Cause; comment: string }) {
    if (LIVE_ENABLED) {
      sendFeedback(eventId, d)
        .then(() => {
          rebuildLive();
          toast("Feedback tersimpan untuk pembelajaran sistem", "success");
        })
        .catch((err: Error) => toast(`Feedback gagal disimpan: ${err.message}`, "error", undefined, 0));
      return;
    }
    const ev = app!.events.find((e) => e.id === eventId);
    if (!ev || !ev.cutSource || ev.value == null || ev.limit == null) return;
    const fb: Feedback = {
      id: `f${Date.now().toString(36)}${(evSeq++).toString(36)}`,
      eventId, jalurId: ev.jalurId, ts: Date.now(), cutSource: ev.cutSource, ...d,
      context: { param: ev.param, value: ev.value, limit: ev.limit, overloadSec: ev.overloadSec ?? 0, ratio: ev.value / ev.limit },
    };
    setApp((st) => ({
      ...st,
      feedback: [...st.feedback, fb],
      events: st.events.map((e) => (e.id === eventId ? { ...e, feedbackId: fb.id } : e)),
    }));
    toast("Feedback tersimpan untuk pembelajaran sistem", "success");
  },

  // Alat demo: memicu lonjakan arus pada satu jalur agar alur beban berlebih bisa dicoba.
  simulateOverload(jalurId: string, seconds = 90) {
    if (liveBlocked("Simulasi beban berlebih")) return;
    const j = app!.jalur.find((x) => x.id === jalurId);
    if (!j || !j.relayOn || !j.sensorOnline) return;
    const now = Date.now();
    setApp((st) => ({
      ...st,
      anomalies: [
        ...st.anomalies.filter((a) => a.end > now - 7 * 86400e3),
        { jalurId, param: "current", start: now, end: now + seconds * 1000, peak: j.thresholds.currentMax * 1.2, shape: "surge" },
      ],
    }));
    toast(`Simulasi beban berlebih dimulai pada ${jalurLabel(j)}`, "info");
  },

  acknowledge(eventId: string) {
    if (LIVE_ENABLED) {
      ackLive(eventId);
      rebuildLive();
      return;
    }
    setApp((st) => ({
      ...st,
      events: st.events.map((e) => (e.id === eventId ? { ...e, acknowledged: true, handledBy: st.user.name } : e)),
    }));
  },

  // Menghapus semua kejadian dari daftar. Mode live: hanya disembunyikan di browser ini, data Supabase tetap.
  clearEvents() {
    const now = Date.now();
    if (LIVE_ENABLED) {
      clearLive(now);
      rebuildLive(now);
    } else {
      // Kejadian yang masih ditunggu keputusannya (hold) tetap disimpan agar dialog beban berlebih tidak rusak.
      setApp((st) => {
        const keep = new Set(Object.values(st.holds).map((h) => h.eventId));
        return { ...st, events: st.events.filter((e) => keep.has(e.id)) };
      });
    }
    toast("Notifikasi dibersihkan", "success");
  },

  saveThresholds(jalurId: string, th: Thresholds) {
    if (liveBlocked("Mengubah ambang (ubah di Supabase, tabel devices)")) return;
    const j = app!.jalur.find((x) => x.id === jalurId);
    if (!j) return;
    const o = j.thresholds;
    const changes: string[] = [];
    if (o.voltMin !== th.voltMin) changes.push(`Tegangan min. ${fmtNum(o.voltMin, 0)} → ${fmtNum(th.voltMin, 0)} V`);
    if (o.voltMax !== th.voltMax) changes.push(`Tegangan maks. ${fmtNum(o.voltMax, 0)} → ${fmtNum(th.voltMax, 0)} V`);
    if (o.currentMax !== th.currentMax) changes.push(`Arus maks. ${fmtNum(o.currentMax, 1)} → ${fmtNum(th.currentMax, 1)} A`);
    if (o.powerMax !== th.powerMax) changes.push(`Daya maks. ${fmtNum(o.powerMax, 0)} → ${fmtNum(th.powerMax, 0)} W`);
    if (o.pfMin !== th.pfMin) changes.push(`PF min. ${fmtNum(o.pfMin, 2)} → ${fmtNum(th.pfMin, 2)}`);
    if (o.debounceSec !== th.debounceSec) changes.push(`Debounce ${o.debounceSec} → ${th.debounceSec} dtk`);
    if (!changes.length) return;
    const now = Date.now();
    const ev = makeEvent(j, {
      type: "config", param: "Ambang", startedAt: now, endedAt: now,
      detail: changes.join("; "), handledBy: userName(), acknowledged: true,
    });
    setApp((st) => ({
      ...st,
      jalur: st.jalur.map((x) =>
        x.id === jalurId ? { ...x, thresholds: th, thresholdsChangedBy: st.user.name, thresholdsChangedAt: now } : x,
      ),
      events: [ev, ...st.events],
    }));
    toast(`Ambang ${jalurLabel(j)} disimpan`, "success");
  },

  addJalur(name: string, sensorId: string): Jalur | null {
    if (liveBlocked("Menambah jalur")) return null;
    const number = Math.max(0, ...app!.jalur.map((j) => j.number)) + 1;
    const now = Date.now();
    const j: Jalur = {
      id: `j${number}`, number, name, sensorId,
      relayOn: true, sensorOnline: true, offlineSince: null,
      thresholds: { ...DEFAULT_THRESHOLDS }, cutMode: "ask",
      thresholdsChangedBy: userName(), thresholdsChangedAt: now,
      offSnapshot: null, createdAt: now,
    };
    setApp((st) => ({ ...st, jalur: [...st.jalur, j] }));
    toast(`${jalurLabel(j)} ditambahkan`, "success");
    return j;
  },

  renameJalur(jalurId: string, name: string) {
    if (liveBlocked("Mengganti nama jalur")) return;
    setApp((st) => ({ ...st, jalur: st.jalur.map((j) => (j.id === jalurId ? { ...j, name } : j)) }));
    toast("Nama jalur diperbarui", "success");
  },

  removeJalur(jalurId: string) {
    if (liveBlocked("Menghapus jalur")) return;
    const j = app!.jalur.find((x) => x.id === jalurId);
    if (!j) return;
    setApp((st) => ({ ...st, jalur: st.jalur.filter((x) => x.id !== jalurId) }));
    toast(`${jalurLabel(j)} dihapus`, "info");
  },

  testConnection(jalurId: string): { ok: boolean; message: string } {
    const j = app!.jalur.find((x) => x.id === jalurId);
    if (!j) return { ok: false, message: "Jalur tidak ditemukan" };
    const res = LIVE_ENABLED
      ? j.sensorOnline
        ? { ok: true, message: `${j.sensorId} mengirim data` }
        : { ok: false, message: `${j.sensorId} tidak mengirim data. Periksa ESP32, WiFi, dan backend.` }
      : j.sensorOnline
      ? { ok: true, message: `${j.sensorId} merespons` }
      : { ok: false, message: `${j.sensorId} tidak merespons. Periksa kabel RS485 dan catu daya sensor.` };
    toast(res.message, res.ok ? "success" : "error");
    return res;
  },

  dismissRec(id: string) {
    setApp((st) => ({ ...st, dismissedRecs: [...st.dismissedRecs, id] }));
  },

  updateFacility(name: string, panelName: string, limitW: number) {
    if (liveBlocked("Pengaturan panel")) return;
    setApp((st) => ({ ...st, facility: { name, panelName }, panel: { ...st.panel, limitW } }));
    toast("Pengaturan panel disimpan", "success");
  },

  resetDemo() {
    if (liveBlocked("Setel ulang data demo")) return;
    app = seedState(Date.now());
    for (const k of Object.keys(overSince)) delete overSince[k];
    for (const k of Object.keys(condSince)) delete condSince[k];
    for (const k of Object.keys(clearSince)) delete clearSince[k];
    live = computeLive(Date.now());
    appListeners.forEach((l) => l());
    liveListeners.forEach((l) => l());
    persist();
    toast("Data demo disetel ulang", "info");
  },
};

function sendRec(id: number, op: "execute" | "dismiss") {
  if (op === "execute") userExecuted.add(id);
  (op === "execute" ? executeRec(id) : dismissRec(id))
    .then(() =>
      toast(op === "execute" ? "Perintah putus relai dikirim ke ESP32" : "Rekomendasi diabaikan, relai tetap menyala", "info"),
    )
    .catch((err: Error) => {
      userExecuted.delete(id);
      toast(`Gagal: ${err.message}`, "error", undefined, 0);
    });
}

export const activeCount = (s: AppState) => activeEvents(s).length;
