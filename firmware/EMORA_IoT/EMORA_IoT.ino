// EMORA dengan pengiriman data ke backend (WiFi + HTTP).
// Logika proteksi (ambang batas, buzzer, relai) sama dengan EMORA.ino dan berjalan di loop()
// tanpa bergantung pada internet. Pengiriman data berjalan di task terpisah sehingga koneksi
// yang lambat atau putus tidak menunda pembacaan sensor dan alarm.

#include <PZEM004Tv30.h>
#include <DHT.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>

#if !__has_include("config.h")
#error "Salin config.example.h menjadi config.h lalu isi WIFI_SSID, API_URL, DEVICE_KEY."
#endif
#include "config.h"
#include "payload.h"

// ----------------------------------------------------
// Pin (sesuai skema hardware)
// ----------------------------------------------------
#define RELAY_PIN    26   // Active LOW
#define DHT_PIN      14
#define BUZZER_PIN   27
#define DHT_TYPE     DHT22

PZEM004Tv30 pzem(Serial2, 16, 17);
DHT dht(DHT_PIN, DHT_TYPE);

// ----------------------------------------------------
// Ambang batas (sama dengan EMORA.ino)
// ----------------------------------------------------
const float VOLT_MIN          = 180.0;
const float VOLT_MAX          = 245.0;
const float CURRENT_MAX       = 2.0;
const float POWER_MAX         = 50.0;
const float TEMP_MAX          = 45.0;
const float FREQ_MIN          = 49.0;
const float FREQ_MAX          = 51.0;
const float PF_MIN            = 0.85;
const float ENERGY_MAX_HOURLY = 100.0;

unsigned long previousMillis = 0;
const long readInterval = 1000;

unsigned long lastHourMillis = 0;
const unsigned long oneHourInterval = 3600000;
float startHourEnergyWh = -1.0;

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
  digitalWrite(RELAY_PIN, LOW);   // Active LOW = ON
  digitalWrite(BUZZER_PIN, LOW);

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
