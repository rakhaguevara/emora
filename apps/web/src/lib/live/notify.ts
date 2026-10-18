"use client";

import { eventValueText } from "../derive";
import { fmtNum } from "../format";
import { toast } from "../toast";
import type { AlertEvent } from "../types";

// Pop-up saat muncul masalah baru (alert backend, ESP32 offline, sensor gagal) dan saat masalah selesai.
// Notifikasi sistem (di luar tab) hanya bila pengguna mengizinkan dan halaman dibuka lewat localhost/HTTPS.

const PROBLEM = new Set<AlertEvent["type"]>(["warning", "offline", "trip"]);
const active = new Map<string, AlertEvent>();
let primed = false;

function title(e: AlertEvent): string {
  if (e.type === "offline") return e.param === "ESP32" ? "ESP32 offline" : `${e.param} tidak terbaca`;
  return `Peringatan ${e.param}`;
}

function body(e: AlertEvent): string {
  return [e.detail ?? eventValueText(e, fmtNum), e.note].filter(Boolean).join(". ");
}

// Diisi komponen klien dengan router.push agar pindah halaman tanpa memuat ulang.
let navigate: (href: string) => void = () => {};
export function setNavigator(fn: (href: string) => void) {
  navigate = fn;
}

const goToAlerts = { label: "Lihat peringatan", onClick: () => navigate("/peringatan") };

// Getar HP (Android/Chrome). iPhone/Safari tidak mendukung; browser juga mengabaikannya sebelum
// pengguna pernah menyentuh halaman.
export function vibrate(pattern: number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* tidak didukung */
  }
}

const ANOMALY_VIBRATION = [400, 150, 400, 150, 800];
// Alert dari backend = nilai di luar ambang batas (anomali)
const isAnomaly = (e: AlertEvent) => e.type === "warning" && e.id.startsWith("a");

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window && window.isSecureContext;
}

function systemNotify(e: AlertEvent) {
  if (!notificationsSupported() || Notification.permission !== "granted" || document.visibilityState === "visible") return;
  try {
    const n = new Notification(`EMORA: ${title(e)}`, { body: body(e), tag: e.id });
    n.onclick = () => {
      window.focus();
      navigate("/peringatan");
    };
  } catch {
    /* sebagian browser HP hanya mengizinkan notifikasi lewat service worker */
  }
}

// relayOn: bila relai menyala, anomali baru juga memunculkan pop-up hitung mundur (LiveAnomalyHost),
// jadi toast untuk anomali dilewati agar tidak dobel.
export function notifyChanges(events: AlertEvent[], relayOn: boolean) {
  const now = events.filter((e) => PROBLEM.has(e.type) && e.endedAt == null);
  if (!primed) {
    primed = true;
    for (const e of now) active.set(e.id, e);
    if (now.some(isAnomaly)) vibrate(ANOMALY_VIBRATION);
    if (now.length === 1) toast(`${title(now[0])}: ${body(now[0])}`, "error", goToAlerts, 0);
    else if (now.length > 1) toast(`${now.length} masalah aktif: ${now.map(title).join(", ")}`, "error", goToAlerts, 0);
    return;
  }
  const ids = new Set(now.map((e) => e.id));
  for (const e of now) {
    if (active.has(e.id)) continue;
    active.set(e.id, e);
    if (isAnomaly(e)) vibrate(ANOMALY_VIBRATION);
    // Suhu tidak memunculkan pop-up hitung mundur (tidak memicu trip), jadi tetap ditampilkan sebagai toast
    if (!(isAnomaly(e) && relayOn && e.param !== "Suhu")) toast(`${title(e)}: ${body(e)}`, "error", goToAlerts, 0);
    systemNotify(e);
  }
  for (const [id, e] of active) {
    if (ids.has(id)) continue;
    active.delete(id);
    // Hilang karena selesai (bukan karena dibersihkan): beri tahu pulih
    if (events.some((x) => x.id === id && x.endedAt != null)) {
      toast(e.type === "offline" ? `${e.param} kembali terhubung` : `${e.param} kembali normal`, "success");
    }
  }
}
