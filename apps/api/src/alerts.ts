import type { Telemetry, Thresholds } from './schema.js';

export type AlertType =
  | 'undervoltage' | 'overvoltage' | 'overcurrent' | 'overpower'
  | 'overheat' | 'frequency' | 'power_factor' | 'energy_hourly';

// Jenis alert yang tidak memicu pemutusan relai: suhu panel (DHT22) hanya peringatan.
export const NO_TRIP: ReadonlySet<AlertType> = new Set(['overheat']);

export interface Violation {
  type: AlertType;
  value: number;
  threshold: number;
}

// Aturan sama dengan deteksi anomali di EMORA.ino.
export function evaluate(t: Telemetry, th: Thresholds): Violation[] {
  const out: Violation[] = [];
  const { voltage, current, power, temperature, frequency, pf, hourly_energy_wh } = t;

  if (voltage != null) {
    if (voltage < th.volt_min) out.push({ type: 'undervoltage', value: voltage, threshold: th.volt_min });
    else if (voltage > th.volt_max) out.push({ type: 'overvoltage', value: voltage, threshold: th.volt_max });
  }
  if (current != null && current > th.current_max)
    out.push({ type: 'overcurrent', value: current, threshold: th.current_max });
  if (power != null && power > th.power_max)
    out.push({ type: 'overpower', value: power, threshold: th.power_max });
  if (temperature != null && temperature > th.temp_max)
    out.push({ type: 'overheat', value: temperature, threshold: th.temp_max });
  if (frequency != null && (frequency < th.freq_min || frequency > th.freq_max))
    out.push({
      type: 'frequency',
      value: frequency,
      threshold: frequency < th.freq_min ? th.freq_min : th.freq_max,
    });
  // PF hanya berarti bila ada beban (di bawah ~1 W PZEM membaca PF 0)
  if (pf != null && pf < th.pf_min && (power ?? 0) > 1)
    out.push({ type: 'power_factor', value: pf, threshold: th.pf_min });
  if (hourly_energy_wh != null && hourly_energy_wh > th.energy_hourly_max_wh)
    out.push({ type: 'energy_hourly', value: hourly_energy_wh, threshold: th.energy_hourly_max_wh });

  return out;
}
