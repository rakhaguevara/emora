import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { startAutomation } from './automation.js';
import { registerFeedbackRoutes } from './feedback.js';
import { ingest, setIngestLogger, UnknownDeviceError } from './ingest.js';
import { startMqtt } from './mqtt.js';
import { registerRelayRoutes } from './relay.js';
import { telemetrySchema } from './schema.js';
import { supabase } from './supabase.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get('/health', async () => ({ ok: true }));

// Ingest HTTP untuk ESP32 (alternatif MQTT).
app.post('/ingest', async (req, reply) => {
  if (req.headers['x-device-key'] !== config.ingestApiKey) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
  const parsed = telemetrySchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: 'invalid_payload', issues: parsed.error.issues });
  try {
    await ingest(parsed.data, (err) => req.log.error({ err }, 'Gagal menyimpan ke Supabase'));
    return reply.code(202).send({ ok: true });
  } catch (err) {
    if (err instanceof UnknownDeviceError) return reply.code(404).send({ error: 'unknown_device' });
    throw err;
  }
});

// Pembacaan terbaru satu device.
app.get<{ Params: { id: string } }>('/api/devices/:id/latest', async (req, reply) => {
  const { data, error } = await supabase
    .from('readings').select('*').eq('device_id', req.params.id)
    .order('ts', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return reply.code(404).send({ error: 'no_data' });
  return data;
});

// Riwayat pembacaan: ?minutes=60&limit=1000
app.get<{ Params: { id: string }; Querystring: { minutes?: string; limit?: string } }>(
  '/api/devices/:id/readings',
  async (req) => {
    const minutes = Math.min(Number(req.query.minutes ?? 60), 7 * 24 * 60);
    const limit = Math.min(Number(req.query.limit ?? 1000), 5000);
    const since = new Date(Date.now() - minutes * 60_000).toISOString();
    const { data, error } = await supabase
      .from('readings').select('*').eq('device_id', req.params.id)
      .gte('ts', since).order('ts', { ascending: false }).limit(limit);
    if (error) throw error;
    return data;
  },
);

registerRelayRoutes(app);
registerFeedbackRoutes(app);
setIngestLogger(app.log);
await startAutomation(app);
startMqtt(app.log);
await app.listen({ port: config.port, host: '0.0.0.0' });
