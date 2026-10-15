#include <PZEM004Tv30.h>
#include <DHT.h>

// ----------------------------------------------------
// Definisi Pin Sesuai Skema Hardware
// ----------------------------------------------------
#define RELAY_PIN    26   // Active LOW Relay (Hanya untuk mengalirkan daya utama)
#define DHT_PIN      14   // Data Sensor DHT22
#define BUZZER_PIN   27   // Alarm Buzzer Indikator
#define DHT_TYPE     DHT22

PZEM004Tv30 pzem(Serial2, 16, 17);
DHT dht(DHT_PIN, DHT_TYPE);

// ----------------------------------------------------
// Batas Ambang Peringatan (Thresholds)
// ----------------------------------------------------
const float VOLT_MIN          = 180.0; // Volt (Undervoltage)
const float VOLT_MAX          = 245.0; // Volt (Overvoltage)
const float CURRENT_MAX       = 2.0;   // Ampere (Overcurrent - Sesuaikan dengan kapasitas beban/MCB)
const float POWER_MAX         = 50.0;  // Watt (Overpower)
const float TEMP_MAX          = 45.0;  // Celsius (Overheat)

// Ambang Batas Manajemen Energi
const float FREQ_MIN          = 49.0;  // Hz (Frekuensi Minimal PLN)
const float FREQ_MAX          = 51.0;  // Hz (Frekuensi Maksimal PLN)
const float PF_MIN            = 0.85;  // Power Factor Minimal
const float ENERGY_MAX_HOURLY = 100.0; // Wh (Batas Maksimal Konsumsi per Jam)

unsigned long previousMillis = 0;
const long readInterval = 1000; // Pembacaan data setiap 1 detik

// Variabel Pelacak Konsumsi Energi per Jam
unsigned long lastHourMillis = 0;
const unsigned long oneHourInterval = 3600000; // 1 jam dalam milidetik
float startHourEnergyWh = -1.0; 

void setup() {
  Serial.begin(115200);

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  digitalWrite(RELAY_PIN, LOW);  // Active LOW = ON
  digitalWrite(BUZZER_PIN, LOW); // Buzzer MATI awal

  dht.begin();
  
  Serial.println("==================================================");
  Serial.println(" SISTEM MONITORING & MANAJEMEN ENERGI (NO-TRIP)  ");
  Serial.println(" Status Relay: ON (Daya Terhubung ke Beban) ");
  Serial.println("==================================================");
  delay(1000);
}

void loop() {
  unsigned long currentMillis = millis();

  if (currentMillis - previousMillis >= readInterval) {
    previousMillis = currentMillis;

    // Pembacaan Parameter Listrik & Lingkungan
    float voltage     = pzem.voltage();
    float current     = pzem.current();
    float power       = pzem.power();
    float energyKwh   = pzem.energy();
    float frequency   = pzem.frequency();
    float pf          = pzem.pf();
    float temperature = dht.readTemperature();
    float humidity    = dht.readHumidity();

    // Validasi Pembacaan PZEM
    if (isnan(voltage)) {
      Serial.println("[WARNING] Gagal membaca data dari sensor PZEM-004T!");
      return;
    }

    float currentEnergyWh = energyKwh * 1000.0f;

    // Inisialisasi Titik Acuan Energi Awal Jam
    if (startHourEnergyWh < 0.0) {
      startHourEnergyWh = currentEnergyWh;
      lastHourMillis = currentMillis;
    }

    // Reset Siklus Perhitungan Setiap 1 Jam
    if (currentMillis - lastHourMillis >= oneHourInterval) {
      lastHourMillis = currentMillis;
      startHourEnergyWh = currentEnergyWh;
    }

    // Hitung Konsumsi Energi Jam Berjalan
    float hourlyEnergyConsumed = currentEnergyWh - startHourEnergyWh;

    // ----------------------------------------------------
    // Deteksi Anomali Per Parameter
    // ----------------------------------------------------
    bool isVoltageAbnormal = (voltage < VOLT_MIN || voltage > VOLT_MAX);
    bool isCurrentAbnormal = (current > CURRENT_MAX);
    bool isPowerAbnormal   = (power > POWER_MAX);
    bool isTempAbnormal    = (!isnan(temperature) && temperature > TEMP_MAX);
    bool isFreqAbnormal    = (frequency < FREQ_MIN || frequency > FREQ_MAX);
    bool isPfAbnormal      = (pf < PF_MIN && power > 5.0); 
    bool isEnergyAbnormal  = (hourlyEnergyConsumed > ENERGY_MAX_HOURLY);

    // Tampilkan Seluruh Parameter ke Serial Monitor
    Serial.printf("V: %.1f V | I: %.3f A | P: %.1f W | Freq: %.1f Hz | E: %.1f Wh | PF: %.2f | Temp: %.1f C | Status: ",
                  voltage, current, power, frequency, currentEnergyWh, pf, temperature);

    // ----------------------------------------------------
    // Indikasi Status & Alarm
    // ----------------------------------------------------
    if (isVoltageAbnormal || isCurrentAbnormal || isPowerAbnormal || isTempAbnormal || isFreqAbnormal || isPfAbnormal || isEnergyAbnormal) {
      digitalWrite(BUZZER_PIN, HIGH);
      Serial.println("[ANOMALI DETEKSI]");

      if (isVoltageAbnormal) {
        if (voltage < VOLT_MIN) {
          Serial.printf("   [!] PERINGATAN: Undervoltage (%.1f V < %.1f V)\n", voltage, VOLT_MIN);
        } else {
          Serial.printf("   [!] PERINGATAN: Overvoltage (%.1f V > %.1f V)\n", voltage, VOLT_MAX);
        }
      }

      if (isCurrentAbnormal) {
        Serial.printf("   [!] PERINGATAN: Overcurrent (%.3f A > %.3f A)\n", current, CURRENT_MAX);
      }

      if (isPowerAbnormal) {
        Serial.printf("   [!] PERINGATAN: Overpower (%.1f W > %.1f W)\n", power, POWER_MAX);
      }

      if (isTempAbnormal) {
        Serial.printf("   [!] PERINGATAN: Overheat (%.1f C > %.1f C)\n", temperature, TEMP_MAX);
      }

      if (isFreqAbnormal) {
        Serial.printf("   [!] PERINGATAN: Frekuensi Tidak Normal (%.1f Hz)\n", frequency);
      }

      if (isPfAbnormal) {
        Serial.printf("   [!] PERINGATAN: Power Factor Buruk (%.2f < %.2f)\n", pf, PF_MIN);
      }

      if (isEnergyAbnormal) {
        Serial.printf("   [!] PERINGATAN: Batas Energi Jam Ini Terlampaui (%.1f Wh > %.1f Wh)\n", hourlyEnergyConsumed, ENERGY_MAX_HOURLY);
      }
    } else {
      digitalWrite(BUZZER_PIN, LOW);
      Serial.println("NORMAL");
    }
  }
}