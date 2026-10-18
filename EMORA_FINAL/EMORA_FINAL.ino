// ====================================================================================
//  EMORA - Energy Copilot  |  Firmware final (satu file)
//  ESP32 + PZEM-004T v3.0 + DHT22 + Relai + Buzzer
//
//  Fungsi:
//   1. Membaca tegangan, arus, daya, energi, frekuensi, PF (PZEM) dan suhu/kelembapan (DHT22) tiap 1 detik.
//   2. Deteksi anomali + buzzer (logika proteksi sama dengan EMORA.ino asli, berjalan lokal tanpa internet).
//   3. Mengirim data ke backend EMORA (POST /ingest) tiap SEND_INTERVAL_MS lewat WiFi,
//      di task terpisah (core 0) sehingga WiFi lambat/putus tidak menunda pembacaan sensor dan alarm.
//   4. Proteksi lokal (tanpa internet): relai diputus ESP32 sendiri bila
//      a. nilai melewati BATAS KRITIS selama HARD_TRIP_READS pembacaan berturut-turut, atau
//      b. backend tidak terjangkau dan anomali (selain suhu) berlangsung OFFLINE_CUT_SEC detik.
//      Setelah itu relai terkunci OFF: perintah ON dari dashboard ditolak selama nilai masih kritis.
//      Kejadian dilaporkan lewat telemetri (local_trip_at / local_trip_reason).
//
//  Cara pakai: isi bagian "PENGATURAN" di bawah, pilih board ESP32 Dev Module, lalu Upload.
//  Library (Library Manager): "PZEM004Tv30" (mandulaj), "DHT sensor library" (Adafruit),
//  "Adafruit Unified Sensor". WiFi/HTTPClient sudah termasuk di paket board ESP32.
// ====================================================================================

#include <PZEM004Tv30.h>
#include <DHT.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <math.h>

// ====================================================================================
//  PENGATURAN  (WAJIB diisi sebelum upload)
//  Jangan bagikan / commit file ini ke repo publik setelah diisi password dan kunci.
// ====================================================================================
#define WIFI_SSID        "Pemerintah_Sebelah"        // WiFi 2,4 GHz (ESP32 tidak mendukung 5 GHz)
#define WIFI_PASSWORD    "progamANGGARAN"

// Alamat backend. JANGAN "localhost" (itu menunjuk ke ESP32 sendiri).
//   Jaringan lokal : "http://192.168.1.10:4000/ingest"  (IP laptop yang menjalankan backend)
//   Backend online : "https://api.contoh.com/ingest"
#define API_URL          "http://10.34.216.135:4000/ingest"

#define DEVICE_KEY       "c8e96e5d9c86e73363ab7bc0586d435576422104d89f3d73"   // sama persis dengan INGEST_API_KEY di apps/api/.env
#define DEVICE_ID        "emora-01"                    // sama dengan kolom id di tabel devices (Supabase)
#define SEND_INTERVAL_MS 5000                          // jeda kirim data (ms)
#define RELAY_POLL_MS    1000                          // jeda cek perintah relai dari dashboard (ms)

// ----------------------------------------------------
// Pin (sesuai skema hardware)
// ----------------------------------------------------
#define RELAY_PIN    26   // Active LOW Relay (LOW = ON, mengalirkan daya ke beban)
#define DHT_PIN      14   // Data DHT22
#define BUZZER_PIN   27   // Buzzer alarm

// Pola buzzer: N bip pendek (N = jumlah masalah), lalu jeda, berulang.
//   1 masalah : bip ........ bip ........
//   2 masalah : bip bip .... bip bip ....
//   3 masalah : bip bip bip  bip bip bip
#define BEEP_ON_MS   150   // lama satu bip
#define BEEP_OFF_MS  150   // jeda antar bip dalam satu kelompok
#define BEEP_GAP_MS  900   // jeda antar kelompok
#define DHT_TYPE     DHT22
// PZEM-004T: RX2 = GPIO16, TX2 = GPIO17 (Serial2). RX ESP32 ke TX PZEM, TX ESP32 ke RX PZEM.

// ----------------------------------------------------
// Ambang batas peringatan (sama dengan EMORA.ino)
// ----------------------------------------------------
const float VOLT_MIN          = 180.0;  // V  (undervoltage)
const float VOLT_MAX          = 245.0;  // V  (overvoltage)
const float CURRENT_MAX       = 2.0;    // A  (overcurrent, sesuaikan dengan kapasitas beban/MCB)
const float POWER_MAX         = 50.0;   // W  (overpower)
const float TEMP_MAX          = 45.0;   // C  (overheat)
const float FREQ_MIN          = 49.0;   // Hz
const float FREQ_MAX          = 51.0;   // Hz
const float PF_MIN            = 0.85;
const float ENERGY_MAX_HOURLY = 100.0;  // Wh per jam

// ----------------------------------------------------
// Proteksi lokal: batas kritis (di atas ambang peringatan; relai diputus ESP32 tanpa menunggu backend)
// ----------------------------------------------------
const float HARD_VOLT_MIN     = 170.0;  // V
const float HARD_VOLT_MAX     = 255.0;  // V
const float HARD_CURRENT_MAX  = 3.0;    // A  (1,5 x CURRENT_MAX)
const float HARD_POWER_MAX    = 75.0;   // W  (1,5 x POWER_MAX)
const int   HARD_TRIP_READS   = 2;      // pembacaan berturut-turut (1 detik sekali) sebelum memutus
const unsigned long OFFLINE_AFTER_MS = 15000;  // tanpa balasan backend selama ini = offline
const unsigned long OFFLINE_CUT_SEC  = 30;     // sama dengan DECISION_SEC di backend (batas pengaman terlama)

PZEM004Tv30 pzem(Serial2, 16, 17);
DHT dht(DHT_PIN, DHT_TYPE);

unsigned long previousMillis = 0;
const long readInterval = 1000;

unsigned long lastHourMillis = 0;
const unsigned long oneHourInterval = 3600000;
float startHourEnergyWh = -1.0;

// Status relai (sumber kebenaran; ditulis lewat setRelay). Awal: ON, sama seperti EMORA.ino.
volatile bool relayOn = true;

// Proteksi lokal. relayMux melindungi relayOn + kunci trip karena ditulis loop (core 1) dan task jaringan (core 0).
portMUX_TYPE relayMux = portMUX_INITIALIZER_UNLOCKED;
bool localTrip = false;              // relai terkunci OFF oleh proteksi lokal
unsigned long localTripAt = 0;       // millis() saat memutus (penanda kejadian untuk backend)
char localTripReason[96] = "";
volatile bool criticalNow = false;   // pembacaan terakhir melewati batas kritis
volatile unsigned long lastBackendOk = 0;   // millis() balasan backend terakhir (0 = belum pernah)
int hardCount = 0;
unsigned long offlineAnomalySince = 0;

// Status kegagalan PZEM: pesan di Serial dibatasi agar tidak membanjiri layar
bool pzemFailing = false;
unsigned long pzemFailSince = 0;
unsigned long lastPzemWarn = 0;

// ----------------------------------------------------
// Data telemetri + pembuat JSON (NaN/Inf ditulis null; backend menerima null)
// ----------------------------------------------------
struct Telemetry {
  const char* deviceId;
  float voltage, current, power, energyWh, frequency, pf;
  float temperature, humidity, hourlyEnergyWh;
  bool relayOn, buzzerOn;
  unsigned long localTripAt;         // 0 = tidak sedang terkunci proteksi lokal
  char localTripReason[96];
};

static int appendNum(char* buf, size_t cap, int pos, const char* key, float v, int decimals) {
  if (pos < 0 || (size_t)pos >= cap) return -1;
  int n;
  if (isnan(v) || isinf(v)) n = snprintf(buf + pos, cap - pos, ",\"%s\":null", key);
  else n = snprintf(buf + pos, cap - pos, ",\"%s\":%.*f", key, decimals, (double)v);
  return (n < 0 || (size_t)(pos + n) >= cap) ? -1 : pos + n;
}

// Mengembalikan panjang JSON, atau -1 bila buffer terlalu kecil.
static int buildTelemetryJson(char* buf, size_t cap, const Telemetry& t) {
  int pos = snprintf(buf, cap, "{\"device_id\":\"%s\"", t.deviceId);
  if (pos < 0 || (size_t)pos >= cap) return -1;
  pos = appendNum(buf, cap, pos, "voltage", t.voltage, 1);
  pos = appendNum(buf, cap, pos, "current", t.current, 3);
  pos = appendNum(buf, cap, pos, "power", t.power, 1);
  pos = appendNum(buf, cap, pos, "energy_wh", t.energyWh, 2);
  pos = appendNum(buf, cap, pos, "frequency", t.frequency, 1);
  pos = appendNum(buf, cap, pos, "pf", t.pf, 2);
  pos = appendNum(buf, cap, pos, "temperature", t.temperature, 1);
  pos = appendNum(buf, cap, pos, "humidity", t.humidity, 1);
  pos = appendNum(buf, cap, pos, "hourly_energy_wh", t.hourlyEnergyWh, 2);
  if (pos < 0) return -1;
  int n = snprintf(buf + pos, cap - pos, ",\"relay_on\":%s,\"buzzer_on\":%s",
                   t.relayOn ? "true" : "false", t.buzzerOn ? "true" : "false");
  if (n < 0 || (size_t)(pos + n) >= cap) return -1;
  pos += n;
  // Alasan dibuat sendiri oleh firmware (tanpa tanda kutip), jadi aman ditulis apa adanya
  if (t.localTripAt) n = snprintf(buf + pos, cap - pos, ",\"local_trip_at\":%lu,\"local_trip_reason\":\"%s\"}",
                                  t.localTripAt, t.localTripReason);
  else n = snprintf(buf + pos, cap - pos, "}");
  return (n < 0 || (size_t)(pos + n) >= cap) ? -1 : pos + n;
}

void setRelay(bool on) {
  relayOn = on;
  digitalWrite(RELAY_PIN, on ? LOW : HIGH);   // Active LOW: LOW = ON
}

// Memutus relai oleh proteksi lokal dan mengunci sampai ada perintah ON yang aman.
void tripLocal(const char* reason) {
  portENTER_CRITICAL(&relayMux);
  bool was = relayOn;
  setRelay(false);
  localTrip = true;
  localTripAt = millis() | 1;   // tidak pernah 0
  strncpy(localTripReason, reason, sizeof(localTripReason) - 1);
  localTripReason[sizeof(localTripReason) - 1] = 0;
  portEXIT_CRITICAL(&relayMux);
  if (was) Serial.printf("[PROTEKSI] Relai diputus lokal: %s\n", reason);
}

bool backendReachable() {
  unsigned long ok = lastBackendOk;
  return ok != 0 && millis() - ok < OFFLINE_AFTER_MS;
}

// Mengisi status relai + proteksi lokal ke telemetri
void fillRelayState(Telemetry& t) {
  portENTER_CRITICAL(&relayMux);
  t.relayOn = relayOn;
  t.localTripAt = localTrip ? localTripAt : 0;
  memcpy(t.localTripReason, localTripReason, sizeof(t.localTripReason));
  portEXIT_CRITICAL(&relayMux);
}

// Jumlah masalah yang sedang terjadi (ditulis loop, dibaca task buzzer)
volatile int problemCount = 0;

// Task buzzer (terpisah dari loop agar ritme bip tidak terganggu pembacaan PZEM yang lambat)
void buzzerTask(void*) {
  int lastCount = 0;
  unsigned long patternStart = 0;
  for (;;) {
    int n = problemCount;
    unsigned long now = millis();
    if (n != lastCount) {        // jumlah masalah berubah: mulai pola baru dari awal
      lastCount = n;
      patternStart = now;
    }
    bool on = false;
    if (n > 0) {
      unsigned long slot = BEEP_ON_MS + BEEP_OFF_MS;
      unsigned long period = n * slot + BEEP_GAP_MS;
      unsigned long phase = (now - patternStart) % period;
      on = phase < n * slot && (phase % slot) < BEEP_ON_MS;
    }
    digitalWrite(BUZZER_PIN, on ? HIGH : LOW);
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

// ----------------------------------------------------
// Data terbaru untuk task jaringan (dilindungi spinlock)
// ----------------------------------------------------
portMUX_TYPE dataMux = portMUX_INITIALIZER_UNLOCKED;
Telemetry latest;
bool latestFresh = false;

void publishLatest(const Telemetry& t) {
  portENTER_CRITICAL(&dataMux);
  latest = t;
  latestFresh = true;
  portEXIT_CRITICAL(&dataMux);
}

bool takeLatest(Telemetry& out) {
  bool fresh;
  portENTER_CRITICAL(&dataMux);
  out = latest;
  fresh = latestFresh;
  latestFresh = false;
  portEXIT_CRITICAL(&dataMux);
  return fresh;
}

// ----------------------------------------------------
// Task jaringan (core 0): WiFi + POST ke backend
// ----------------------------------------------------
// Satu permintaan HTTP(S) ke backend. Mengembalikan kode HTTP (negatif = gagal tersambung).
int httpRequest(const char* method, const String& url, const char* body, String* response, uint16_t timeoutMs) {
  const bool https = url.startsWith("https");
  WiFiClient plain;
  WiFiClientSecure secure;
  HTTPClient http;
  http.setTimeout(timeoutMs);

  bool begun;
  if (https) {
    // PENTING: setInsecure() tidak memverifikasi sertifikat server. Cukup untuk uji coba;
    // untuk pemakaian nyata ganti dengan secure.setCACert(<sertifikat root server>).
    secure.setInsecure();
    begun = http.begin(secure, url);
  } else {
    begun = http.begin(plain, url);
  }
  if (!begun) {
    Serial.printf("[NET] URL tidak valid: %s\n", url.c_str());
    return -1000;
  }

  http.addHeader("x-device-key", DEVICE_KEY);
  int code;
  if (body) {
    http.addHeader("Content-Type", "application/json");
    code = http.sendRequest(method, (uint8_t*)body, strlen(body));
  } else {
    code = http.sendRequest(method);
  }
  if (response && code > 0) *response = http.getString();
  http.end();
  return code;
}

bool sendTelemetry(const Telemetry& t) {
  char body[512];
  if (buildTelemetryJson(body, sizeof(body), t) < 0) {
    Serial.println("[NET] Buffer JSON terlalu kecil");
    return false;
  }
  // backend menunggu insert Supabase sebelum membalas; lewat hotspot bisa > 3 detik
  int code = httpRequest("POST", API_URL, body, nullptr, 10000);
  if (code == 202) return true;
  Serial.printf("[NET] Gagal kirim, kode: %d%s\n", code,
                code == 401 ? " (DEVICE_KEY salah)" :
                code == 404 ? " (DEVICE_ID belum terdaftar di tabel devices)" :
                code == 400 ? " (payload ditolak)" :
                code < 0    ? " (tidak terhubung ke backend)" : "");
  return false;
}

// ----------------------------------------------------
// Perintah relai dari dashboard
// ----------------------------------------------------
// Alamat backend tanpa "/ingest", mis. "http://10.197.88.135:4000"
String backendBase() {
  String base = API_URL;
  if (base.endsWith("/ingest")) base.remove(base.length() - 7);
  return base;
}

long appliedCommandId = -1;   // perintah terakhir yang sudah diterapkan (-1 = belum ada sejak menyala)

// Mengambil perintah terakhir; bila belum diterapkan, tulis GPIO relai lalu kirim konfirmasi ke backend.
void pollRelayCommand() {
  static const String relayUrl = backendBase() + "/api/devices/" + DEVICE_ID + "/relay";
  String resp;
  int code = httpRequest("GET", relayUrl, nullptr, &resp, 3000);
  if (code == 200) lastBackendOk = millis();
  if (code != 200) {
    static unsigned long lastWarn = 0;
    if (millis() - lastWarn >= 30000) {
      lastWarn = millis();
      Serial.printf("[RELAY] Gagal mengambil perintah, kode: %d%s\n", code,
                    code == 404 ? " (backend lama? jalankan ulang npm run dev:api)" : "");
    }
    return;
  }

  // Balasan: {"command_id":12,"action":"off"} atau {"command_id":null}
  int idx = resp.indexOf("\"command_id\":");
  if (idx < 0) return;
  long id = resp.substring(idx + 13).toInt();
  if (id <= 0 || id == appliedCommandId) return;
  bool wantOn = resp.indexOf("\"action\":\"on\"") >= 0;

  // Selama terkunci proteksi lokal dan nilai masih kritis, perintah ON ditolak (konfirmasi relay_on=false).
  bool refused = false;
  portENTER_CRITICAL(&relayMux);
  if (wantOn && localTrip && criticalNow) {
    refused = true;
  } else {
    if (wantOn) localTrip = false;
    setRelay(wantOn);
  }
  portEXIT_CRITICAL(&relayMux);
  appliedCommandId = id;
  if (refused) Serial.printf("[PROTEKSI] Perintah #%ld ON ditolak: nilai masih melewati batas kritis\n", id);
  else Serial.printf("[RELAY] Perintah #%ld dari dashboard: relai %s\n", id, wantOn ? "ON (daya terhubung)" : "OFF (daya diputus)");

  char ack[64];
  snprintf(ack, sizeof(ack), "{\"command_id\":%ld,\"relay_on\":%s}", id, relayOn ? "true" : "false");
  int ackCode = httpRequest("POST", relayUrl + "/ack", ack, nullptr, 3000);
  if (ackCode != 200) Serial.printf("[RELAY] Gagal mengirim konfirmasi, kode: %d\n", ackCode);
}

void networkTask(void*) {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[NET] Menghubungkan ke WiFi %s\n", WIFI_SSID);

  bool wasConnected = false;
  unsigned long lastSend = 0;
  unsigned long lastRelayPoll = 0;

  for (;;) {
    bool connected = WiFi.status() == WL_CONNECTED;
    if (connected && !wasConnected) {
      Serial.printf("[NET] WiFi terhubung, IP %s, sinyal %d dBm\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
    } else if (!connected && wasConnected) {
      Serial.println("[NET] WiFi terputus, mencoba menyambung ulang");
    }
    wasConnected = connected;

    if (connected && millis() - lastRelayPoll >= RELAY_POLL_MS) {
      lastRelayPoll = millis();
      pollRelayCommand();
    }

    if (connected && millis() - lastSend >= SEND_INTERVAL_MS) {
      Telemetry t;
      if (takeLatest(t)) {
        lastSend = millis();
        if (sendTelemetry(t)) Serial.println("[NET] Data terkirim");
      }
    }
    vTaskDelay(pdMS_TO_TICKS(200));
  }
}

// ----------------------------------------------------
void setup() {
  Serial.begin(115200);

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  setRelay(true);                  // Active LOW = ON; perintah terakhir dari dashboard diterapkan setelah WiFi tersambung
  digitalWrite(BUZZER_PIN, LOW);   // Buzzer mati di awal

  dht.begin();

  Serial.println("==================================================");
  Serial.println(" EMORA - MONITORING & MANAJEMEN ENERGI (IoT)      ");
  Serial.println(" Status Relay: ON (Daya Terhubung ke Beban)       ");
  Serial.printf (" Device: %s\n", DEVICE_ID);
  Serial.println("==================================================");

  xTaskCreatePinnedToCore(networkTask, "net", 8192, nullptr, 1, nullptr, 0);
  xTaskCreatePinnedToCore(buzzerTask, "buzzer", 2048, nullptr, 1, nullptr, 1);
  delay(1000);
}

void loop() {
  unsigned long currentMillis = millis();

  if (currentMillis - previousMillis >= readInterval) {
    previousMillis = currentMillis;

    float voltage     = pzem.voltage();
    float current     = pzem.current();
    float power       = pzem.power();
    float energyKwh   = pzem.energy();
    float frequency   = pzem.frequency();
    float pf          = pzem.pf();
    float temperature = dht.readTemperature();
    float humidity    = dht.readHumidity();

    if (isnan(voltage)) {
      if (!pzemFailing) {
        pzemFailing = true;
        pzemFailSince = currentMillis;
        lastPzemWarn = 0;
      }
      if (lastPzemWarn == 0 || currentMillis - lastPzemWarn >= 10000) {
        lastPzemWarn = currentMillis;
        Serial.printf("[WARNING] Gagal membaca sensor PZEM-004T (%lu detik). Cek listrik PLN di terminal AC PZEM, "
                      "kabel TX/RX (silang), dan catu 5V.\n", (currentMillis - pzemFailSince) / 1000);
      }
      // Tanpa PZEM, listrik tidak bisa dinilai: buzzer hanya menghitung suhu. Relai dibiarkan.
      // Data tetap dikirim dengan nilai listrik null agar dashboard tahu ESP32 hidup tetapi sensor bermasalah.
      problemCount = (!isnan(temperature) && temperature > TEMP_MAX) ? 1 : 0;
      hardCount = 0;
      criticalNow = false;
      offlineAnomalySince = 0;
      Telemetry t = {DEVICE_ID, NAN, NAN, NAN, NAN, NAN, NAN, temperature, humidity, NAN,
                     false, problemCount > 0, 0, ""};   // status relai diisi fillRelayState
      fillRelayState(t);
      publishLatest(t);
      return;
    }
    if (pzemFailing) {
      pzemFailing = false;
      Serial.printf("[INFO] Sensor PZEM-004T kembali terbaca setelah %lu detik\n", (currentMillis - pzemFailSince) / 1000);
    }

    float currentEnergyWh = energyKwh * 1000.0f;

    // Titik acuan energi awal jam, direset tiap 1 jam
    if (startHourEnergyWh < 0.0) {
      startHourEnergyWh = currentEnergyWh;
      lastHourMillis = currentMillis;
    }
    if (currentMillis - lastHourMillis >= oneHourInterval) {
      lastHourMillis = currentMillis;
      startHourEnergyWh = currentEnergyWh;
    }
    float hourlyEnergyConsumed = currentEnergyWh - startHourEnergyWh;

    bool isVoltageAbnormal = (voltage < VOLT_MIN || voltage > VOLT_MAX);
    bool isCurrentAbnormal = (current > CURRENT_MAX);
    bool isPowerAbnormal   = (power > POWER_MAX);
    bool isTempAbnormal    = (!isnan(temperature) && temperature > TEMP_MAX);
    bool isFreqAbnormal    = (frequency < FREQ_MIN || frequency > FREQ_MAX);
    bool isPfAbnormal      = (pf < PF_MIN && power > 1.0);   // PF hanya berarti bila ada beban
    bool isEnergyAbnormal  = (hourlyEnergyConsumed > ENERGY_MAX_HOURLY);

    int problems = isVoltageAbnormal + isCurrentAbnormal + isPowerAbnormal + isTempAbnormal +
                   isFreqAbnormal + isPfAbnormal + isEnergyAbnormal;
    problemCount = problems;   // buzzer: bip sebanyak jumlah masalah

    bool anomaly = isVoltageAbnormal || isCurrentAbnormal || isPowerAbnormal || isTempAbnormal ||
                   isFreqAbnormal || isPfAbnormal || isEnergyAbnormal;

    // ---- Proteksi lokal ----
    char why[96] = "";
    if (current > HARD_CURRENT_MAX)
      snprintf(why, sizeof(why), "Arus %.2f A melewati batas kritis %.2f A", current, HARD_CURRENT_MAX);
    else if (power > HARD_POWER_MAX)
      snprintf(why, sizeof(why), "Daya %.1f W melewati batas kritis %.1f W", power, HARD_POWER_MAX);
    else if (voltage > HARD_VOLT_MAX || voltage < HARD_VOLT_MIN)
      snprintf(why, sizeof(why), "Tegangan %.1f V di luar batas kritis %.0f-%.0f V", voltage, HARD_VOLT_MIN, HARD_VOLT_MAX);
    criticalNow = why[0] != 0;
    hardCount = criticalNow ? hardCount + 1 : 0;
    if (relayOn && hardCount >= HARD_TRIP_READS) tripLocal(why);

    // Backend tidak terjangkau: ESP32 menjalankan pengaman sendiri (suhu tetap hanya peringatan)
    bool tripAnomaly = problems > (isTempAbnormal ? 1 : 0);
    if (tripAnomaly && relayOn && !backendReachable()) {
      if (!offlineAnomalySince) offlineAnomalySince = currentMillis;
      if (currentMillis - offlineAnomalySince >= OFFLINE_CUT_SEC * 1000UL) {
        snprintf(why, sizeof(why), "Backend tak terjangkau, anomali berlangsung %lu dtk", OFFLINE_CUT_SEC);
        tripLocal(why);
        offlineAnomalySince = 0;
      }
    } else {
      offlineAnomalySince = 0;
    }

    Serial.printf("V: %.1f V | I: %.3f A | P: %.1f W | Freq: %.1f Hz | E: %.1f Wh | PF: %.2f | Temp: %.1f C | Status: %s\n",
                  voltage, current, power, frequency, currentEnergyWh, pf, temperature,
                  anomaly ? "[ANOMALI DETEKSI]" : "NORMAL");

    if (anomaly) {
      Serial.printf("   Jumlah masalah: %d (buzzer %d bip)\n", problems, problems);
      if (isVoltageAbnormal) {
        Serial.printf("   [!] %s (%.1f V)\n", voltage < VOLT_MIN ? "Undervoltage" : "Overvoltage", voltage);
      }
      if (isCurrentAbnormal) Serial.printf("   [!] Overcurrent (%.3f A > %.3f A)\n", current, CURRENT_MAX);
      if (isPowerAbnormal)   Serial.printf("   [!] Overpower (%.1f W > %.1f W)\n", power, POWER_MAX);
      if (isTempAbnormal)    Serial.printf("   [!] Overheat (%.1f C > %.1f C)\n", temperature, TEMP_MAX);
      if (isFreqAbnormal)    Serial.printf("   [!] Frekuensi tidak normal (%.1f Hz)\n", frequency);
      if (isPfAbnormal)      Serial.printf("   [!] Power factor buruk (%.2f < %.2f)\n", pf, PF_MIN);
      if (isEnergyAbnormal)  Serial.printf("   [!] Batas energi jam ini terlampaui (%.1f Wh > %.1f Wh)\n", hourlyEnergyConsumed, ENERGY_MAX_HOURLY);
    }

    Telemetry t = {DEVICE_ID, voltage, current, power, currentEnergyWh, frequency, pf,
                   temperature, humidity, hourlyEnergyConsumed,
                   false, problemCount > 0, 0, ""};   // status relai diisi fillRelayState
    fillRelayState(t);
    publishLatest(t);
  }
}
