// ====================================================================================
//  EMORA - Energy Copilot  |  Firmware final (satu file)
//  ESP32 + PZEM-004T v3.0 + DHT22 + Relai + Buzzer
//
//  Fungsi:
//   1. Membaca tegangan, arus, daya, energi, frekuensi, PF (PZEM) dan suhu/kelembapan (DHT22) tiap 1 detik.
//   2. Deteksi anomali + buzzer (logika proteksi sama dengan EMORA.ino asli, berjalan lokal tanpa internet).
//   3. Mengirim data ke backend EMORA (POST /ingest) tiap SEND_INTERVAL_MS lewat WiFi,
//      di task terpisah (core 0) sehingga WiFi lambat/putus tidak menunda pembacaan sensor dan alarm.
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
#define WIFI_SSID        "nama-wifi-kamu"        // WiFi 2,4 GHz (ESP32 tidak mendukung 5 GHz)
#define WIFI_PASSWORD    "password-wifi-kamu"

// Alamat backend. JANGAN "localhost" (itu menunjuk ke ESP32 sendiri).
//   Jaringan lokal : "http://192.168.1.10:4000/ingest"  (IP laptop yang menjalankan backend)
//   Backend online : "https://api.contoh.com/ingest"
#define API_URL          "http://192.168.1.10:4000/ingest"

#define DEVICE_KEY       "ganti-dengan-string-acak"   // sama persis dengan INGEST_API_KEY di apps/api/.env
#define DEVICE_ID        "emora-01"                    // sama dengan kolom id di tabel devices (Supabase)
#define SEND_INTERVAL_MS 5000                          // jeda kirim data (ms)

// ----------------------------------------------------
// Pin (sesuai skema hardware)
// ----------------------------------------------------
#define RELAY_PIN    26   // Active LOW Relay (LOW = ON, mengalirkan daya ke beban)
#define DHT_PIN      14   // Data DHT22
#define BUZZER_PIN   27   // Buzzer alarm
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

PZEM004Tv30 pzem(Serial2, 16, 17);
DHT dht(DHT_PIN, DHT_TYPE);

unsigned long previousMillis = 0;
const long readInterval = 1000;

unsigned long lastHourMillis = 0;
const unsigned long oneHourInterval = 3600000;
float startHourEnergyWh = -1.0;

// ----------------------------------------------------
// Data telemetri + pembuat JSON (NaN/Inf ditulis null; backend menerima null)
// ----------------------------------------------------
struct Telemetry {
  const char* deviceId;
  float voltage, current, power, energyWh, frequency, pf;
  float temperature, humidity, hourlyEnergyWh;
  bool relayOn, buzzerOn;
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
  int n = snprintf(buf + pos, cap - pos, ",\"relay_on\":%s,\"buzzer_on\":%s}",
                   t.relayOn ? "true" : "false", t.buzzerOn ? "true" : "false");
  return (n < 0 || (size_t)(pos + n) >= cap) ? -1 : pos + n;
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
bool sendTelemetry(const Telemetry& t) {
  char body[384];
  if (buildTelemetryJson(body, sizeof(body), t) < 0) {
    Serial.println("[NET] Buffer JSON terlalu kecil");
    return false;
  }

  const bool https = strncmp(API_URL, "https", 5) == 0;
  WiFiClient plain;
  WiFiClientSecure secure;
  HTTPClient http;
  http.setTimeout(3000);

  bool begun;
  if (https) {
    // PENTING: setInsecure() tidak memverifikasi sertifikat server. Cukup untuk uji coba;
    // untuk pemakaian nyata ganti dengan secure.setCACert(<sertifikat root server>).
    secure.setInsecure();
    begun = http.begin(secure, API_URL);
  } else {
    begun = http.begin(plain, API_URL);
  }
  if (!begun) {
    Serial.println("[NET] URL tidak valid");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);
  int code = http.POST((uint8_t*)body, strlen(body));
  http.end();

  if (code == 202) return true;
  Serial.printf("[NET] Gagal kirim, kode: %d%s\n", code,
                code == 401 ? " (DEVICE_KEY salah)" :
                code == 404 ? " (DEVICE_ID belum terdaftar di tabel devices)" :
                code == 400 ? " (payload ditolak)" :
                code < 0    ? " (tidak terhubung ke backend)" : "");
  return false;
}

void networkTask(void*) {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[NET] Menghubungkan ke WiFi %s\n", WIFI_SSID);

  bool wasConnected = false;
  unsigned long lastSend = 0;

  for (;;) {
    bool connected = WiFi.status() == WL_CONNECTED;
    if (connected && !wasConnected) {
      Serial.printf("[NET] WiFi terhubung, IP %s, sinyal %d dBm\n",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI());
    } else if (!connected && wasConnected) {
      Serial.println("[NET] WiFi terputus, mencoba menyambung ulang");
    }
    wasConnected = connected;

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
  digitalWrite(RELAY_PIN, LOW);    // Active LOW = ON
  digitalWrite(BUZZER_PIN, LOW);   // Buzzer mati di awal

  dht.begin();

  Serial.println("==================================================");
  Serial.println(" EMORA - MONITORING & MANAJEMEN ENERGI (IoT)      ");
  Serial.println(" Status Relay: ON (Daya Terhubung ke Beban)       ");
  Serial.printf (" Device: %s\n", DEVICE_ID);
  Serial.println("==================================================");

  xTaskCreatePinnedToCore(networkTask, "net", 8192, nullptr, 1, nullptr, 0);
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
      Serial.println("[WARNING] Gagal membaca data dari sensor PZEM-004T!");
      return;
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
    bool isPfAbnormal      = (pf < PF_MIN && power > 5.0);
    bool isEnergyAbnormal  = (hourlyEnergyConsumed > ENERGY_MAX_HOURLY);

    bool anomaly = isVoltageAbnormal || isCurrentAbnormal || isPowerAbnormal || isTempAbnormal ||
                   isFreqAbnormal || isPfAbnormal || isEnergyAbnormal;

    Serial.printf("V: %.1f V | I: %.3f A | P: %.1f W | Freq: %.1f Hz | E: %.1f Wh | PF: %.2f | Temp: %.1f C | Status: %s\n",
                  voltage, current, power, frequency, currentEnergyWh, pf, temperature,
                  anomaly ? "[ANOMALI DETEKSI]" : "NORMAL");

    if (anomaly) {
      digitalWrite(BUZZER_PIN, HIGH);
      if (isVoltageAbnormal) {
        Serial.printf("   [!] %s (%.1f V)\n", voltage < VOLT_MIN ? "Undervoltage" : "Overvoltage", voltage);
      }
      if (isCurrentAbnormal) Serial.printf("   [!] Overcurrent (%.3f A > %.3f A)\n", current, CURRENT_MAX);
      if (isPowerAbnormal)   Serial.printf("   [!] Overpower (%.1f W > %.1f W)\n", power, POWER_MAX);
      if (isTempAbnormal)    Serial.printf("   [!] Overheat (%.1f C > %.1f C)\n", temperature, TEMP_MAX);
      if (isFreqAbnormal)    Serial.printf("   [!] Frekuensi tidak normal (%.1f Hz)\n", frequency);
      if (isPfAbnormal)      Serial.printf("   [!] Power factor buruk (%.2f < %.2f)\n", pf, PF_MIN);
      if (isEnergyAbnormal)  Serial.printf("   [!] Batas energi jam ini terlampaui (%.1f Wh > %.1f Wh)\n", hourlyEnergyConsumed, ENERGY_MAX_HOURLY);
    } else {
      digitalWrite(BUZZER_PIN, LOW);
    }

    Telemetry t = {DEVICE_ID, voltage, current, power, currentEnergyWh, frequency, pf,
                   temperature, humidity, hourlyEnergyConsumed,
                   digitalRead(RELAY_PIN) == LOW, digitalRead(BUZZER_PIN) == HIGH};
    publishLatest(t);
  }
}
