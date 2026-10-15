// Simulator ESP32: kirim data dummy ke POST /ingest agar dashboard bisa dikembangkan tanpa hardware.
const url = process.env.SIM_API_URL ?? 'http://localhost:4000';
const deviceId = process.env.SIM_DEVICE_ID ?? 'emora-01';
const interval = Number(process.env.SIM_INTERVAL_MS ?? 2000);
const key = process.env.INGEST_API_KEY ?? '';

let energyWh = 1000;
let hourStart = energyWh;
let tick = 0;
const jitter = (base: number, spread: number) => base + (Math.random() - 0.5) * spread;

async function send() {
  tick++;
  const anomaly = tick % 60 > 50; // ~10 tick anomali tiap 60 tick
  const voltage = anomaly ? jitter(250, 4) : jitter(220, 4);
  const power = jitter(anomaly ? 70 : 30, 6);
  const current = power / voltage / 0.9;
  energyWh += (power * interval) / 3_600_000;

  const body = {
    device_id: deviceId,
    voltage: +voltage.toFixed(1),
    current: +current.toFixed(3),
    power: +power.toFixed(1),
    energy_wh: +energyWh.toFixed(2),
    frequency: +jitter(50, 0.2).toFixed(1),
    pf: +jitter(0.92, 0.06).toFixed(2),
    temperature: +jitter(32, 3).toFixed(1),
    humidity: +jitter(60, 8).toFixed(1),
    hourly_energy_wh: +(energyWh - hourStart).toFixed(2),
    relay_on: true,
    buzzer_on: anomaly,
  };
  const res = await fetch(`${url}/ingest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-device-key': key },
    body: JSON.stringify(body),
  });
  console.log(res.status, JSON.stringify(body));
}

console.log(`Simulator -> ${url}/ingest tiap ${interval}ms sebagai ${deviceId}`);
setInterval(() => send().catch((e) => console.error(e.message)), interval);
