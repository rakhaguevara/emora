-- EMORA: jejak audit perintah relai, riwayat ganti mode, feedback pemutusan, dan proteksi lokal ESP32.
-- Login belum ada: semua tindakan dari dashboard tercatat dengan peran 'operator' dan nama yang diisi di dashboard.

-- Perintah relai: siapa, perannya, alasan, dan mode saat perintah dibuat.
-- source 'local' = relai diputus sendiri oleh ESP32 (proteksi lokal), dilaporkan lewat telemetri.
alter table public.relay_commands drop constraint relay_commands_source_check;
alter table public.relay_commands add constraint relay_commands_source_check
  check (source in ('user','recommendation','auto','local'));
alter table public.relay_commands
  add column actor      text not null default 'Sistem',
  add column actor_role text not null default 'system' check (actor_role in ('operator','admin','system')),
  add column reason     text,
  add column mode       text check (mode in ('auto','semi_auto'));

-- Rekomendasi: nilai pelanggaran saat dibuat (bahan ML) dan siapa yang memutuskan.
alter table public.recommendations
  add column violations jsonb not null default '[]'::jsonb,   -- [{type, value, threshold}]
  add column decided_by text;

-- Riwayat ganti mode respons
create table public.mode_changes (
  id         bigint generated always as identity primary key,
  device_id  text not null references public.devices(id) on delete cascade,
  ts         timestamptz not null default now(),
  mode       text not null check (mode in ('auto','semi_auto')),
  prev_mode  text check (prev_mode in ('auto','semi_auto')),
  actor      text not null,
  actor_role text not null check (actor_role in ('operator','admin','system'))
);
create index mode_changes_device_ts_idx on public.mode_changes (device_id, ts desc);
alter table public.mode_changes enable row level security;
create policy "read mode changes" on public.mode_changes for select to anon, authenticated using (true);

-- Feedback: isian sama dengan form dashboard (dampak, ketepatan waktu, dugaan penyebab).
-- Satu feedback per pemutusan (rekomendasi atau perintah).
alter table public.feedback
  drop column appropriate,
  add column cut_source text not null check (cut_source in ('auto','failsafe','manual','local')),
  add column outcome    text not null check (outcome in ('none','minor','severe')),
  add column timing     text not null check (timing in ('early','right','late')),
  add column cause      text not null default 'unknown' check (cause in ('load_up','equipment','surge','unknown')),
  add column actor      text not null,
  add column actor_role text not null check (actor_role in ('operator','admin','system'));
create unique index feedback_rec_uniq on public.feedback (recommendation_id) where recommendation_id is not null;
create unique index feedback_cmd_uniq on public.feedback (command_id) where command_id is not null;

alter publication supabase_realtime add table public.feedback, public.mode_changes;
