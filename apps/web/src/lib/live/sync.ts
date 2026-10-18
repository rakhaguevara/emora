import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_THRESHOLDS } from "../constants";
import { api } from "../api";
import { getSession, initials } from "../auth/session";
import type { AlertEvent, AppState, Cause, CutSource, Feedback, Jalur, Outcome, PanelEnv, Thresholds, Timing } from "../types";
import { DEFAULT_TARIFF, type Tariff } from "../tariff";
import { syncEnergy, syncTips } from "./energy";
import { appendHistory, getHistory, KEEP_MS, type LiveSample } from "./history";

// Mode live: dashboard membaca tabel devices, readings, alerts di Supabase (kunci publishable, hanya baca).
// Aktif bila NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY terisi di .env.local.
// Data baru datang lewat Supabase Realtime (WebSocket); polling REST tetap jalan sebagai cadangan.

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const LIVE_ENABLED = !!(SB_URL && SB_KEY);
export const LIVE_DEVICE_ID = process.env.NEXT_PUBLIC_EMORA_DEVICE_ID || "emora-01";

// Daftarkan riwayat kosong sejak awal: tanpa ini, sebelum data termuat (atau bila 24 jam tanpa data)
// sim/engine.ts tidak menemukan riwayat dan kembali ke data simulasi.
if (LIVE_ENABLED) appendHistory(LIVE_DEVICE_ID, [], Date.now());

const POLL_MS = 5000;
// Saat WebSocket tersambung, polling hanya untuk menyusul data yang mungkin terlewat.
const POLL_REALTIME_MS = 30_000;
const DEVICE_POLL_MS = 60_000;
// Tanpa pembacaan baru selama ini, ESP32 dianggap offline (firmware mengirim tiap 5 detik).
export const OFFLINE_MS = 20_000;
const PAGE = 1000;
// Hitung mundur respons anomali; harus sama dengan apps/api/src/automation.ts
export const AUTO_CUT_SEC = 10;
export const DECISION_SEC = 30;
const ACK_KEY = "emora.live.ack";
const CLEAR_KEY = "emora.live.clearedAt";

interface DeviceRow {
  id: string;
  name: string;
  location: string | null;
  thresholds: Record<string, number> | null;
  mode: DeviceMode;
  created_at: string;
  // Tarif (diatur admin). Belum ada bila migration 20261018010000_energy_admin.sql belum dijalankan.
  tariff_class?: string;
  tariff_per_kwh?: number;
  tax_percent?: number;
}
export type DeviceMode = "auto" | "semi_auto";
export interface ViolationRow {
  type: string;
  value: number;
  threshold: number;
}
export interface RecRow {
  id: number;
  ts: string;
  action: string;
  reason: string | null;
  status: "pending" | "executed" | "dismissed" | "expired";
  decided_at: string | null;
  decided_by?: string | null;
  violations?: ViolationRow[];
}
interface ReadingRow {
  ts: string;
  voltage: number | null;
  current: number | null;
  power: number | null;
  frequency: number | null;
  pf: number | null;
  temperature: number | null;
  humidity: number | null;
  relay_on: boolean | null;
}
export interface CommandRow {
  id: number;
  ts: string;
  action: "on" | "off";
  source: string;
  status: "pending" | "sent" | "acked" | "failed";
  acked_at: string | null;
  recommendation_id: number | null;
  actor?: string;
  actor_role?: string;
  reason?: string | null;
  mode?: DeviceMode | null;
}
interface FeedbackRow {
  id: number;
  ts: string;
  recommendation_id: number | null;
  command_id: number | null;
  cut_source: CutSource;
  outcome: Outcome;
  timing: Timing;
  cause: Cause;
  comment: string | null;
  actor: string;
}
interface ModeChangeRow {
  id: number;
  ts: string;
  mode: DeviceMode;
  prev_mode: DeviceMode | null;
  actor: string;
}
interface AlertRow {
  id: number;
  ts: string;
  type: string;
  value: number | null;
  threshold: number | null;
  resolved_at: string | null;
}

// 'realtime' = WebSocket tersambung; 'polling' = WebSocket gagal, data diambil tiap 5 detik.
export type LinkStatus = "connecting" | "realtime" | "polling";

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: { apikey: SB_KEY! }, cache: "no-store" });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

let sb: SupabaseClient | null = null;
let link: LinkStatus = "connecting";
let device: DeviceRow | null = null;
const alerts = new Map<number, AlertRow>();
const commands = new Map<number, CommandRow>();
const recs = new Map<number, RecRow>();
const feedbackRows = new Map<number, FeedbackRow>();
const modeChanges = new Map<number, ModeChangeRow>();
let synced = false; // riwayat 24 jam sudah selesai dimuat
let cursor = 0; // ts pembacaan terakhir yang sudah diproses

// Detak terakhir dari ESP32, termasuk pembacaan saat PZEM gagal (nilai listrik null).
let heartbeat: { ts: number; relayOn: boolean | null } | null = null;
// Awal kegagalan sensor yang sedang berlangsung (null = sensor terbaca pada pembacaan terakhir)
let pzemFaultSince: number | null = null;
// Suhu & kelembapan terakhir dari DHT22 (dikirim juga saat PZEM gagal)
let env: PanelEnv | null = null;
let dhtFaultSince: number | null = null;

const acked = new Set<string>(loadAcks());
// Kejadian yang mulai sebelum waktu ini disembunyikan (tombol "Bersihkan notifikasi"). Data di Supabase tetap ada.
let clearedAt = loadClearedAt();
// Kejadian turunan (offline, sensor gagal) yang pernah muncul di sesi ini, agar tetap tercatat setelah selesai.
const derivedLog = new Map<string, AlertEvent>();

function loadAcks(): string[] {
  try {
    return JSON.parse(localStorage.getItem(ACK_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function loadClearedAt(): number {
  try {
    return Number(localStorage.getItem(CLEAR_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function ackLive(eventId: string) {
  acked.add(eventId);
  try {
    localStorage.setItem(ACK_KEY, JSON.stringify([...acked].slice(-500)));
  } catch {
    /* abaikan */
  }
}

export function clearLive(now: number) {
  clearedAt = now;
  derivedLog.clear();
  try {
    localStorage.setItem(CLEAR_KEY, String(now));
  } catch {
    /* abaikan */
  }
}

export const getLinkStatus = () => link;
export const isSynced = () => synced;

const toSample = (r: ReadingRow): LiveSample => ({
  ts: Date.parse(r.ts),
  voltage: r.voltage ?? 0,
  current: r.current ?? 0,
  power: r.power ?? 0,
  pf: r.relay_on === false ? null : r.pf,
  frequency: r.frequency ?? 0,
  energyKwh: 0,
  temperature: r.temperature,
  humidity: r.humidity,
  relayOn: r.relay_on,
});

// Memproses pembacaan baru (urut waktu). Pembacaan dengan voltage null = PZEM gagal dibaca:
// dicatat sebagai detak ESP32, tetapi tidak masuk riwayat grafik.
function ingestRows(rows: ReadingRow[]) {
  const ok: LiveSample[] = [];
  for (const r of [...rows].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))) {
    const ts = Date.parse(r.ts);
    if (ts <= cursor) continue;
    cursor = ts;
    heartbeat = { ts, relayOn: r.relay_on };
    env = { ts, temperature: r.temperature, humidity: r.humidity };
    const pzemOk = r.voltage != null;
    pzemFaultSince = pzemOk ? null : (pzemFaultSince ?? ts);
    dhtFaultSince = r.temperature != null ? null : (dhtFaultSince ?? ts);
    if (pzemOk) ok.push(toSample(r));
  }
  if (ok.length) appendHistory(LIVE_DEVICE_ID, ok, Date.now());
}

const enc = encodeURIComponent;

async function syncReadings() {
  let since = cursor || Date.now() - KEEP_MS;
  for (;;) {
    const rows = await rest<ReadingRow[]>(
      `readings?select=ts,voltage,current,power,frequency,pf,temperature,humidity,relay_on` +
        `&device_id=eq.${enc(LIVE_DEVICE_ID)}&ts=gt.${enc(new Date(since).toISOString())}&order=ts.asc&limit=${PAGE}`,
    );
    ingestRows(rows);
    if (rows.length) since = Date.parse(rows[rows.length - 1].ts);
    if (rows.length < PAGE) break;
  }
}

async function syncAlerts() {
  const rows = await rest<AlertRow[]>(
    `alerts?select=id,ts,type,value,threshold,resolved_at&device_id=eq.${enc(LIVE_DEVICE_ID)}&order=ts.desc&limit=200`,
  );
  alerts.clear();
  for (const a of rows) alerts.set(a.id, a);
}

async function syncCommands() {
  const rows = await rest<CommandRow[]>(
    `relay_commands?select=id,ts,action,source,status,acked_at,recommendation_id,actor,actor_role,reason,mode&device_id=eq.${enc(LIVE_DEVICE_ID)}&order=ts.desc&limit=50`,
  );
  commands.clear();
  for (const c of rows) commands.set(c.id, c);
}

export const getCommand = (id: number) => commands.get(id) ?? null;

async function syncRecs() {
  const rows = await rest<RecRow[]>(
    `recommendations?select=id,ts,action,reason,status,decided_at,decided_by,violations&device_id=eq.${enc(LIVE_DEVICE_ID)}&order=ts.desc&limit=50`,
  );
  recs.clear();
  for (const r of rows) recs.set(r.id, r);
}

async function syncFeedback() {
  const [fb, modes] = await Promise.all([
    rest<FeedbackRow[]>(
      `feedback?select=id,ts,recommendation_id,command_id,cut_source,outcome,timing,cause,comment,actor&device_id=eq.${enc(LIVE_DEVICE_ID)}&order=ts.desc&limit=500`,
    ),
    rest<ModeChangeRow[]>(
      `mode_changes?select=id,ts,mode,prev_mode,actor&device_id=eq.${enc(LIVE_DEVICE_ID)}&order=ts.desc&limit=50`,
    ),
  ]);
  feedbackRows.clear();
  for (const f of fb) feedbackRows.set(f.id, f);
  modeChanges.clear();
  for (const m of modes) modeChanges.set(m.id, m);
}

export const getMode = (): DeviceMode => device?.mode ?? "semi_auto";
export const getRecs = (): RecRow[] => [...recs.values()].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
// Batas waktu hitung mundur sebuah rekomendasi menurut mode saat ini (sama dengan backend)
export const recDeadline = (r: RecRow) => Date.parse(r.ts) + (getMode() === "auto" ? AUTO_CUT_SEC : DECISION_SEC) * 1000;

// Nama pengguna yang login (untuk tampilan; backend mencatat pelaku dari sesi, bukan dari isian browser)
const sessionName = () => getSession()?.user.displayName ?? "Operator";

const devicePath = (path: string) => `/api/devices/${enc(LIVE_DEVICE_ID)}/${path}`;

// Kirim perintah relai ke backend (sesi operator + PIN). Backend menyimpannya di relay_commands; ESP32 mengambilnya tiap 1 detik.
export async function sendRelayCommand(action: "on" | "off", reason: string, pin: string): Promise<CommandRow> {
  const body = await api<CommandRow>("POST", devicePath("relay"), { action, reason, pin });
  const row: CommandRow = {
    ...body, source: "user", acked_at: null, recommendation_id: null,
    actor: sessionName(), actor_role: "operator", reason, mode: getMode(),
  };
  commands.set(row.id, row);
  return row;
}

// Keputusan atas rekomendasi putus relai (wajib PIN operator)
export async function decideRec(id: number, op: "execute" | "dismiss", pin: string) {
  await api("POST", devicePath(`recommendations/${id}/${op}`), { pin });
}

// Feedback untuk kejadian pemutusan (id event: rec<id> atau local<id>)
export async function sendFeedback(
  eventId: string, d: { outcome: Outcome; timing: Timing; cause: Cause; comment: string },
) {
  const target = eventId.startsWith("rec")
    ? { recommendation_id: Number(eventId.slice(3)) }
    : eventId.startsWith("local") ? { command_id: Number(eventId.slice(5)) } : null;
  if (!target) throw new Error("kejadian ini tidak bisa diberi feedback");
  const row = await api<{ id: number }>("POST", devicePath("feedback"), { ...target, ...d });
  // Tampilkan langsung tanpa menunggu polling berikutnya
  feedbackRows.set(row.id, {
    id: row.id, ts: new Date().toISOString(), recommendation_id: target.recommendation_id ?? null,
    command_id: target.command_id ?? null, cut_source: "manual", ...d, actor: sessionName(),
  });
}

async function syncDevice() {
  // select=* agar tetap jalan sebelum kolom tarif ditambahkan migration
  const rows = await rest<DeviceRow[]>(`devices?select=*&id=eq.${enc(LIVE_DEVICE_ID)}`);
  device = rows[0] ?? null;
  if (!device) throw new Error(`Device ${LIVE_DEVICE_ID} tidak ada di tabel devices`);
}

export const getTariff = (): Tariff =>
  device?.tariff_per_kwh
    ? { cls: device.tariff_class ?? DEFAULT_TARIFF.cls, perKwh: device.tariff_per_kwh, taxPct: device.tax_percent ?? 0 }
    : DEFAULT_TARIFF;

// Ringkasan energi & rekomendasi harian: tiap menit, atau segera setelah admin mengubah data.
const ENERGY_POLL_MS = 60_000;
let energyNotify: (() => void) | null = null;
let energyBusy = false;
let energyError: string | null = null;

async function runEnergySync(onError: (msg: string) => void) {
  if (energyBusy) return;
  energyBusy = true;
  try {
    await Promise.all([syncEnergy(LIVE_DEVICE_ID), syncTips(LIVE_DEVICE_ID)]);
    energyError = null;
    energyNotify?.();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg !== energyError) onError(msg);
    energyError = msg;
  } finally {
    energyBusy = false;
  }
}

let energyOnError: (msg: string) => void = () => {};
// Dipanggil halaman Admin setelah menyimpan tarif / rekomendasi
export async function refreshAdminData() {
  try {
    await syncDevice();
  } catch {
    /* polling berikutnya akan mencoba lagi */
  }
  await runEnergySync(energyOnError);
}

function startRealtime(onChange: () => void, catchUp: () => void) {
  sb = createClient(SB_URL!, SB_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const filter = `device_id=eq.${LIVE_DEVICE_ID}`;
  sb.channel(`emora-${LIVE_DEVICE_ID}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "readings", filter }, (p) => {
      if (!synced) return; // riwayat awal belum selesai dimuat; polling yang akan menyusul
      ingestRows([p.new as ReadingRow]);
      onChange();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "alerts", filter }, (p) => {
      if (p.eventType === "DELETE") alerts.delete((p.old as Partial<AlertRow>).id!);
      else alerts.set((p.new as AlertRow).id, p.new as AlertRow);
      onChange();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "recommendations", filter }, (p) => {
      if (p.eventType === "DELETE") recs.delete((p.old as Partial<RecRow>).id!);
      else recs.set((p.new as RecRow).id, p.new as RecRow);
      onChange();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "relay_commands", filter }, (p) => {
      if (p.eventType === "DELETE") commands.delete((p.old as Partial<CommandRow>).id!);
      else commands.set((p.new as CommandRow).id, p.new as CommandRow);
      onChange();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "feedback", filter }, (p) => {
      feedbackRows.set((p.new as FeedbackRow).id, p.new as FeedbackRow);
      onChange();
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "mode_changes", filter }, (p) => {
      modeChanges.set((p.new as ModeChangeRow).id, p.new as ModeChangeRow);
      onChange();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "daily_tips", filter }, () => {
      void syncTips(LIVE_DEVICE_ID).then(onChange, () => {});
    })
    .subscribe((status) => {
      const next: LinkStatus = status === "SUBSCRIBED" ? "realtime" : status === "CLOSED" ? "connecting" : "polling";
      if (next === link) return;
      link = next;
      if (next === "realtime") catchUp(); // susul data yang masuk selama WebSocket terputus
      onChange();
    });
}

// Memulai sinkronisasi. onChange dipanggil setiap ada data baru; onError saat gagal (sekali per jenis pesan).
export function startLiveSync(onChange: () => void, onError: (msg: string) => void) {
  let busy = false;
  let lastDevice = 0;
  let lastPoll = 0;
  let lastError: string | null = null;
  const run = async (force = false) => {
    if (busy) return;
    if (!force && link === "realtime" && Date.now() - lastPoll < POLL_REALTIME_MS) return;
    busy = true;
    try {
      if (!device || Date.now() - lastDevice > DEVICE_POLL_MS) {
        await syncDevice();
        lastDevice = Date.now();
      }
      await Promise.all([syncReadings(), syncAlerts(), syncCommands(), syncRecs(), syncFeedback()]);
      lastPoll = Date.now();
      synced = true;
      lastError = null;
      onChange();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== lastError) onError(msg);
      lastError = msg;
    } finally {
      busy = false;
    }
  };
  void run(true);
  setInterval(() => void run(), POLL_MS);
  startRealtime(onChange, () => void run(true));

  energyNotify = onChange;
  energyOnError = onError;
  void runEnergySync(onError);
  setInterval(() => void runEnergySync(onError), ENERGY_POLL_MS);
}

function mapThresholds(t: Record<string, number> | null | undefined): Thresholds {
  return {
    voltMin: t?.volt_min ?? DEFAULT_THRESHOLDS.voltMin,
    voltMax: t?.volt_max ?? DEFAULT_THRESHOLDS.voltMax,
    currentMax: t?.current_max ?? DEFAULT_THRESHOLDS.currentMax,
    powerMax: t?.power_max ?? DEFAULT_THRESHOLDS.powerMax,
    pfMin: t?.pf_min ?? DEFAULT_THRESHOLDS.pfMin,
    tempMax: t?.temp_max,
    debounceSec: DEFAULT_THRESHOLDS.debounceSec,
  };
}

const ALERT_META: Record<string, { param: string; unit: string }> = {
  undervoltage: { param: "Tegangan", unit: "V" },
  overvoltage: { param: "Tegangan", unit: "V" },
  overcurrent: { param: "Arus", unit: "A" },
  overpower: { param: "Daya", unit: "W" },
  overheat: { param: "Suhu", unit: "°C" },
  frequency: { param: "Frekuensi", unit: "Hz" },
  power_factor: { param: "PF", unit: "" },
  energy_hourly: { param: "Energi per jam", unit: "Wh" },
};

// Parameter anomali yang masih aktif dan memicu pemutusan (suhu hanya peringatan; sama dengan backend).
// Di mode otomatis relai tidak boleh dinyalakan selama daftar ini tidak kosong.
export function blockingAnomalies(): string[] {
  const params = [...alerts.values()]
    .filter((a) => a.resolved_at == null && a.type !== "overheat")
    .map((a) => ALERT_META[a.type]?.param ?? a.type);
  return [...new Set(params)];
}

const ALERT_NOTE: Record<string, string> = {
  undervoltage: "Tegangan di bawah batas. Bila mendekati 0 V, PZEM kemungkinan tidak teraliri listrik PLN.",
  overvoltage: "Tegangan di atas batas.",
  overcurrent: "Arus melewati batas. Periksa beban yang tersambung.",
  overpower: "Daya melewati batas. Kurangi beban.",
  overheat: "Suhu di sekitar panel melewati batas.",
};

// ESP32 masih mengirim data (termasuk saat sensor gagal)
export function isLiveOnline(now: number): boolean {
  return !!heartbeat && now - heartbeat.ts <= OFFLINE_MS;
}

// ESP32 online dan PZEM terbaca
export function isSensorOk(now: number): boolean {
  return isLiveOnline(now) && pzemFaultSince == null;
}

// Kunci status yang berubah karena waktu berjalan (tanpa data baru); dipakai untuk memicu render ulang.
export function liveStatusKey(now: number): string {
  return `${isLiveOnline(now)}|${pzemFaultSince}|${dhtFaultSince}`;
}

export const latestEnv = (): PanelEnv | null => env;

// Pembacaan PZEM valid terbaru (null bila sensor sedang gagal)
export function latestLive(): LiveSample | null {
  if (pzemFaultSince != null) return null;
  const hist = getHistory(LIVE_DEVICE_ID);
  return hist?.[hist.length - 1] ?? null;
}

// Awal sesi menyala terakhir: mundur dari pembacaan terbaru selama jeda antar sampel < 1 menit.
function sessionStart(now: number): number {
  const hist = getHistory(LIVE_DEVICE_ID);
  if (!hist?.length) return heartbeat?.ts ?? now;
  let i = hist.length - 1;
  while (i > 0 && hist[i].ts - hist[i - 1].ts < 60_000) i--;
  return hist[i].ts;
}

type Derived = Pick<AlertEvent, "id" | "type" | "param" | "detail" | "note" | "startedAt">;

function derivedEvents(now: number): Derived[] {
  if (!synced) return [];
  if (!isLiveOnline(now)) {
    return [{
      id: `offline-${heartbeat?.ts ?? 0}`, type: "offline", param: "ESP32", detail: "Tidak ada data",
      startedAt: heartbeat?.ts ?? now,
      note: heartbeat
        ? "ESP32 berhenti mengirim data. Periksa catu daya ESP32, WiFi, dan backend (npm run dev:api)."
        : "Belum ada data dalam 24 jam terakhir. Pastikan ESP32 dan backend menyala.",
    }];
  }
  const out: Derived[] = [];
  if (pzemFaultSince != null) {
    out.push({
      id: `pzem-${pzemFaultSince}`, type: "offline", param: "Sensor PZEM", detail: "ESP32 terhubung, sensor tidak terbaca",
      startedAt: pzemFaultSince,
      note: "PZEM-004T tidak menjawab. Periksa listrik PLN di terminal AC PZEM, kabel TX/RX (silang), dan catu 5 V.",
    });
  }
  if (dhtFaultSince != null) {
    out.push({
      id: `dht-${dhtFaultSince}`, type: "warning", param: "Sensor DHT22", detail: "Suhu & kelembapan tidak terbaca",
      startedAt: dhtFaultSince,
      note: "DHT22 tidak terbaca. Periksa kabel data ke GPIO14 dan catu 3,3 V.",
    });
  }
  return out;
}

// Keadaan relai: konfirmasi perintah dari ESP32 yang lebih baru dari telemetri terakhir menang,
// karena telemetri baru datang tiap 5 detik sedangkan konfirmasi relai datang dalam ~1 detik.
function relayState(): boolean {
  const acked = [...commands.values()]
    .filter((c) => c.status === "acked" && c.acked_at)
    .sort((a, b) => Date.parse(b.acked_at!) - Date.parse(a.acked_at!))[0];
  if (acked && (!heartbeat || Date.parse(acked.acked_at!) > heartbeat.ts)) return acked.action === "on";
  return heartbeat?.relayOn ?? true;
}

const MODE_LABEL: Record<DeviceMode, string> = { auto: "Otomatis", semi_auto: "Semi-otomatis" };

// Siapa yang memutus, dari perintah OFF yang tercatat (sama dengan apps/api/src/feedback.ts)
function cutSourceOf(cmd: CommandRow | undefined): CutSource {
  if (!cmd) return "auto";
  if (cmd.source === "local") return "local";
  if (cmd.source === "auto") return cmd.mode === "semi_auto" ? "failsafe" : "auto";
  return "manual";
}

const CUT_TEXT: Record<CutSource, string> = {
  manual: "oleh operator",
  auto: "otomatis",
  failsafe: "oleh pengaman karena tidak ada keputusan",
  local: "oleh proteksi lokal ESP32",
};

const CMD_STATUS: Record<CommandRow["status"], string> = {
  pending: "menunggu ESP32",
  sent: "diterima ESP32",
  acked: "dikonfirmasi ESP32",
  failed: "gagal diterapkan",
};

export function buildLiveApp(prev: AppState | null, now: number): AppState {
  const th = mapThresholds(device?.thresholds);
  const online = isLiveOnline(now);
  const sensorOk = isSensorOk(now);
  const createdAt = device ? Date.parse(device.created_at) : now;
  const label = `Jalur 1 · ${device?.name ?? LIVE_DEVICE_ID}`;
  const userName = sessionName();

  const jalur: Jalur = {
    id: "j1",
    number: 1,
    name: device?.name ?? LIVE_DEVICE_ID,
    sensorId: LIVE_DEVICE_ID,
    relayOn: relayState(),
    sensorOnline: sensorOk,
    offlineSince: sensorOk ? null : online ? pzemFaultSince : (heartbeat?.ts ?? now),
    thresholds: th,
    cutMode: device?.mode === "auto" ? "auto" : "ask",
    thresholdsChangedBy: "Supabase",
    thresholdsChangedAt: createdAt,
    offSnapshot: null,
    createdAt,
  };

  const base = { jalurId: "j1", jalurLabel: label, cutSource: null, overloadSec: null, feedbackId: null };

  const events: AlertEvent[] = [...alerts.values()]
    .filter((a) => Date.parse(a.ts) > clearedAt)
    .map((a) => {
      const id = `a${a.id}`;
      const meta = ALERT_META[a.type] ?? { param: a.type, unit: "" };
      const resolved = a.resolved_at != null;
      return {
        ...base,
        id,
        type: "warning",
        param: meta.param,
        value: a.value,
        limit: a.threshold,
        unit: meta.unit,
        detail: null,
        note: ALERT_NOTE[a.type] ?? null,
        startedAt: Date.parse(a.ts),
        endedAt: resolved ? Date.parse(a.resolved_at!) : null,
        handledBy: resolved ? "Otomatis" : acked.has(id) ? userName : null,
        acknowledged: resolved || acked.has(id),
      };
    });

  const fbByRec = new Map<number, FeedbackRow>();
  const fbByCmd = new Map<number, FeedbackRow>();
  for (const f of feedbackRows.values()) {
    if (f.recommendation_id != null) fbByRec.set(f.recommendation_id, f);
    if (f.command_id != null) fbByCmd.set(f.command_id, f);
  }

  // Perintah relai dari operator (alasan + nama) dan pemutusan oleh proteksi lokal ESP32.
  // Perintah dari rekomendasi / mode otomatis ditampilkan lewat kejadian rekomendasinya di bawah.
  for (const c of commands.values()) {
    const ts = Date.parse(c.ts);
    if (ts <= clearedAt) continue;
    if (c.source === "user") {
      events.push({
        ...base, id: `cmd${c.id}`, type: "manual", param: "Relai",
        value: null, limit: null, unit: "",
        detail: `${c.action === "on" ? "ON" : "OFF"} oleh operator · ${c.reason ?? "tanpa alasan"} · ${CMD_STATUS[c.status]}`,
        note: c.mode ? `Mode saat itu: ${MODE_LABEL[c.mode]}` : null,
        startedAt: ts, endedAt: c.acked_at ? Date.parse(c.acked_at) : ts,
        handledBy: c.actor ?? userName, acknowledged: true,
      });
    } else if (c.source === "local" && c.recommendation_id == null) {
      const fb = fbByCmd.get(c.id);
      events.push({
        ...base, id: `local${c.id}`, type: "trip", param: "Proteksi lokal",
        value: null, limit: null, unit: "", detail: c.reason ?? "Batas kritis terlampaui",
        note: `${c.reason ?? "Batas kritis terlampaui"}. Relai diputus ESP32 sendiri (proteksi lokal).`,
        startedAt: ts, endedAt: ts, handledBy: c.actor ?? "ESP32", acknowledged: true,
        cutSource: "local", overloadSec: 0, feedbackId: fb ? `fb${fb.id}` : null,
      });
    }
  }

  // Hasil rekomendasi putus relai karena anomali
  for (const r of recs.values()) {
    const ts = Date.parse(r.ts);
    if (ts <= clearedAt || r.status === "pending" || r.status === "expired") continue;
    const end = r.decided_at ? Date.parse(r.decided_at) : ts;
    if (r.status === "executed") {
      const cmd = [...commands.values()].find((c) => c.recommendation_id === r.id && c.action === "off");
      const cutSource = cutSourceOf(cmd);
      const v = r.violations?.[0];
      const meta = v ? ALERT_META[v.type] : null;
      const fb = fbByRec.get(r.id);
      events.push({
        ...base, id: `rec${r.id}`, type: "trip", param: meta?.param ?? "Anomali",
        value: v?.value ?? null, limit: v?.threshold ?? null, unit: meta?.unit ?? "", detail: r.reason,
        note: `${r.reason ?? "Nilai di luar ambang batas"}. Relai diputus ${CUT_TEXT[cutSource]}.`,
        startedAt: ts, endedAt: end,
        handledBy: r.decided_by ?? cmd?.actor ?? (cutSource === "manual" ? userName : "Sistem"), acknowledged: true,
        cutSource, overloadSec: Math.round((end - ts) / 1000), feedbackId: fb ? `fb${fb.id}` : null,
      });
    } else {
      events.push({
        ...base, id: `rec${r.id}`, type: "manual", param: "Relai",
        value: null, limit: null, unit: "", detail: "Rekomendasi putus diabaikan, relai tetap menyala",
        note: r.reason, startedAt: ts, endedAt: end, handledBy: r.decided_by ?? userName, acknowledged: true,
      });
    }
  }

  // Riwayat ganti mode respons
  for (const m of modeChanges.values()) {
    const ts = Date.parse(m.ts);
    if (ts <= clearedAt) continue;
    events.push({
      ...base, id: `mode${m.id}`, type: "config", param: "Mode respons",
      value: null, limit: null, unit: "",
      detail: `${m.prev_mode ? MODE_LABEL[m.prev_mode] : "—"} → ${MODE_LABEL[m.mode]}`,
      note: null, startedAt: ts, endedAt: ts, handledBy: m.actor, acknowledged: true,
    });
  }

  // Kejadian turunan: yang aktif diperbarui, yang hilang ditandai selesai.
  const active = derivedEvents(now);
  const activeIds = new Set(active.map((d) => d.id));
  for (const [id, e] of derivedLog) {
    if (!activeIds.has(id) && e.endedAt == null) {
      derivedLog.set(id, { ...e, endedAt: now, handledBy: e.handledBy ?? "Otomatis", acknowledged: true });
    }
  }
  for (const d of active) {
    if (d.startedAt <= clearedAt) continue;
    derivedLog.set(d.id, {
      ...base, ...d, value: null, limit: null, unit: "", endedAt: null,
      handledBy: acked.has(d.id) ? userName : null, acknowledged: acked.has(d.id),
    });
  }
  events.push(...derivedLog.values());
  events.sort((a, b) => b.startedAt - a.startedAt);

  return {
    version: 0,
    seededAt: now,
    facility: { name: device?.location ?? "EMORA", panelName: device?.name ?? LIVE_DEVICE_ID },
    panel: { deviceId: LIVE_DEVICE_ID, firmware: "EMORA_FINAL", bootedAt: sessionStart(now), limitW: th.powerMax },
    user: { name: userName, initials: initials(userName) },
    jalur: [jalur],
    offLog: {},
    anomalies: [],
    events,
    dismissedRecs: prev?.dismissedRecs ?? [],
    holds: {},
    feedback: liveFeedback(events),
  };
}

// Feedback live dalam bentuk yang sama dengan mode demo (dipakai FeedbackInsights)
function liveFeedback(events: AlertEvent[]): Feedback[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  return [...feedbackRows.values()].map((f) => {
    const eventId = f.recommendation_id != null ? `rec${f.recommendation_id}` : `local${f.command_id}`;
    const ev = byId.get(eventId);
    const value = ev?.value ?? 0;
    const limit = ev?.limit ?? 0;
    return {
      id: `fb${f.id}`, eventId, jalurId: "j1", ts: Date.parse(f.ts), cutSource: ev?.cutSource ?? f.cut_source,
      outcome: f.outcome, timing: f.timing, cause: f.cause, comment: f.comment ?? "",
      context: { param: ev?.param ?? "—", value, limit, overloadSec: ev?.overloadSec ?? 0, ratio: limit ? value / limit : 0 },
    };
  });
}
