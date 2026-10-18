import mqtt from 'mqtt';
import type { FastifyBaseLogger } from 'fastify';
import { config } from './config.js';
import { ingest } from './ingest.js';
import { telemetrySchema } from './schema.js';

// Topik: emora/<device_id>/telemetry, payload JSON sesuai telemetrySchema.
export function startMqtt(log: FastifyBaseLogger) {
  if (!config.mqtt.url) {
    log.info('MQTT_URL kosong, subscriber MQTT dinonaktifkan');
    return;
  }
  const client = mqtt.connect(config.mqtt.url, {
    username: config.mqtt.username,
    password: config.mqtt.password,
  });

  client.on('connect', () => {
    log.info(`MQTT terhubung, subscribe ${config.mqtt.topic}`);
    client.subscribe(config.mqtt.topic, { qos: 1 });
  });
  client.on('error', (err) => log.error({ err }, 'MQTT error'));

  client.on('message', async (_topic, payload) => {
    try {
      const parsed = telemetrySchema.safeParse(JSON.parse(payload.toString()));
      if (!parsed.success) return log.warn({ issues: parsed.error.issues }, 'Payload MQTT tidak valid');
      await ingest(parsed.data, (err) => log.error({ err }, 'Gagal menyimpan pesan MQTT'));
    } catch (err) {
      log.error({ err }, 'Gagal memproses pesan MQTT');
    }
  });
}
