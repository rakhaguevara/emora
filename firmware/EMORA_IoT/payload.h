#pragma once
// Pembuat JSON telemetri. Sengaja tanpa dependensi Arduino agar bisa diuji di komputer.
// Nilai NaN/Inf ditulis sebagai null (JSON tidak mengenal NaN); backend menerima null.
#include <math.h>
#include <stdio.h>

struct Telemetry {
  const char* deviceId;
  float voltage, current, power, energyWh, frequency, pf;
  float temperature, humidity, hourlyEnergyWh;
  bool relayOn, buzzerOn;
};

static inline int appendNum(char* buf, size_t cap, int pos, const char* key, float v, int decimals) {
  if (pos < 0 || (size_t)pos >= cap) return -1;
  int n;
  if (isnan(v) || isinf(v)) n = snprintf(buf + pos, cap - pos, ",\"%s\":null", key);
  else n = snprintf(buf + pos, cap - pos, ",\"%s\":%.*f", key, decimals, (double)v);
  return (n < 0 || (size_t)(pos + n) >= cap) ? -1 : pos + n;
}

// Mengembalikan panjang JSON, atau -1 bila buffer terlalu kecil.
static inline int buildTelemetryJson(char* buf, size_t cap, const Telemetry& t) {
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
