import { z } from 'zod';

// Kontrak payload telemetri dari ESP32 (HTTP body atau pesan MQTT).
// Nilai sensor boleh null: DHT22 bisa gagal baca (NaN tidak valid di JSON).
const num = z.number().finite().nullable().optional();

export const telemetrySchema = z.object({
  device_id: z.string().min(1).max(64),
  voltage: num,
  current: num,
  power: num,
  energy_wh: num,
  frequency: num,
  pf: num,
  temperature: num,
  humidity: num,
  hourly_energy_wh: num,
  relay_on: z.boolean().optional(),
  buzzer_on: z.boolean().optional(),
});

export type Telemetry = z.infer<typeof telemetrySchema>;

export const thresholdsSchema = z.object({
  volt_min: z.number(),
  volt_max: z.number(),
  current_max: z.number(),
  power_max: z.number(),
  temp_max: z.number(),
  freq_min: z.number(),
  freq_max: z.number(),
  pf_min: z.number(),
  energy_hourly_max_wh: z.number(),
});

export type Thresholds = z.infer<typeof thresholdsSchema>;
