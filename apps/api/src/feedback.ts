import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf, requireUser } from './auth/guard.js';
import { supabase } from './supabase.js';

// Feedback pengguna atas sebuah pemutusan relai; bahan evaluasi respons sistem dan pelatihan ML.
// Dashboard -> POST /api/devices/:id/feedback (sesi operator)
// Target: rekomendasi yang sudah dieksekusi (recommendation_id), atau perintah OFF tanpa rekomendasi
// seperti proteksi lokal ESP32 atau OFF manual (command_id). Satu feedback per pemutusan.

const body = z.object({
  recommendation_id: z.number().int().optional(),
  command_id: z.number().int().optional(),
  outcome: z.enum(['none', 'minor', 'severe']),
  timing: z.enum(['early', 'right', 'late']),
  cause: z.enum(['load_up', 'equipment', 'surge', 'unknown']).default('unknown'),
  comment: z.string().trim().max(300).optional(),
}).refine((b) => (b.recommendation_id == null) !== (b.command_id == null), {
  message: 'Isi salah satu: recommendation_id atau command_id',
});

type CutSource = 'auto' | 'failsafe' | 'manual' | 'local';
interface CommandRow { id: number; action: string; source: string; mode: string | null }

// Siapa yang memutus, dari perintah OFF yang tercatat
function cutSourceOf(cmd: CommandRow): CutSource {
  if (cmd.source === 'local') return 'local';
  if (cmd.source === 'auto') return cmd.mode === 'auto' ? 'auto' : 'failsafe';
  return 'manual'; // 'recommendation' (pengguna menekan "Putus sekarang") atau 'user'
}

export function registerFeedbackRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/api/devices/:id/feedback', async (req, reply) => {
    const user = await requireUser(req, reply, 'operator');
    if (!user) return;
    const parsed = body.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_payload', message: parsed.error.issues[0]?.message, issues: parsed.error.issues });
    }
    const b = parsed.data;
    const deviceId = req.params.id;

    let q = supabase.from('relay_commands').select('id,action,source,mode').eq('device_id', deviceId).eq('action', 'off');
    q = b.recommendation_id != null ? q.eq('recommendation_id', b.recommendation_id) : q.eq('id', b.command_id!);
    const { data: cmds, error } = await q.order('ts', { ascending: true }).limit(1);
    if (error) throw error;
    const cmd = cmds?.[0] as CommandRow | undefined;
    if (!cmd) return reply.code(404).send({ error: 'not_found', message: 'Pemutusan relai tidak ditemukan' });

    const by = actorOf(user);
    const { data, error: e } = await supabase.from('feedback').insert({
      device_id: deviceId,
      recommendation_id: b.recommendation_id ?? null,
      command_id: cmd.id, // selalu diisi, sehingga indeks unik command_id mencegah feedback ganda lewat jalur mana pun
      cut_source: cutSourceOf(cmd),
      outcome: b.outcome, timing: b.timing, cause: b.cause, comment: b.comment || null,
      actor: by.actor, actor_role: by.role, actor_id: by.id,
    }).select('id').single();
    if (e?.code === '23505') return reply.code(409).send({ error: 'duplicate', message: 'Feedback untuk pemutusan ini sudah tercatat' });
    if (e) throw e;
    req.log.info({ deviceId, feedbackId: data.id, actor: by.actor }, 'Feedback tersimpan');
    return reply.code(201).send(data);
  });
}
