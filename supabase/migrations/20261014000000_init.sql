-- EMORA: skema awal. Data bersifat sementara (retensi singkat), lihat purge_old_readings().

create table public.devices (
  id          text primary key,                 -- mis. 'emora-01' (sama dengan device_id di payload ESP32)
  name        text not null default 'EMORA',
  location    text,
  -- Ambang batas, default sama dengan konstanta di EMORA.ino
  thresholds  jsonb not null default '{
    "volt_min": 180, "volt_max": 245, "current_max": 2.0, "power_max": 50,
    "temp_max": 45, "freq_min": 49, "freq_max": 51, "pf_min": 0.85,
    "energy_hourly_max_wh": 100
  }'::jsonb,
  -- Mode respons: 'auto' = relay boleh memutus beban sesuai kriteria; 'semi_auto' = hanya rekomendasi, pengguna yang memutuskan.
  mode        text not null default 'semi_auto' check (mode in ('auto','semi_auto')),
  last_seen   timestamptz,
  created_at  timestamptz not null default now()
);

create table public.readings (
  id                  bigint generated always as identity primary key,
  device_id           text not null references public.devices(id) on delete cascade,
  ts                  timestamptz not null default now(),
  voltage             real,      -- V
  current             real,      -- A
  power               real,      -- W
  energy_wh           real,      -- Wh (kumulatif dari PZEM)
  frequency           real,      -- Hz
  pf                  real,      -- power factor
  temperature         real,      -- C (DHT22)
  humidity            real,      -- % (DHT22)
  hourly_energy_wh    real,      -- Wh pada jam berjalan
  relay_on            boolean,
  buzzer_on           boolean
);
create index readings_device_ts_idx on public.readings (device_id, ts desc);
create index readings_ts_idx on public.readings (ts);

create table public.alerts (
  id          bigint generated always as identity primary key,
  device_id   text not null references public.devices(id) on delete cascade,
  ts          timestamptz not null default now(),
  type        text not null check (type in (
                'undervoltage','overvoltage','overcurrent','overpower',
                'overheat','frequency','power_factor','energy_hourly')),
  value       real,
  threshold   real,
  resolved_at timestamptz
);
create index alerts_device_ts_idx on public.alerts (device_id, ts desc);


-- Penilaian risiko berkala (awal: berbasis aturan; kelak ditambah skor dari model ML)
create table public.risk_assessments (
  id          bigint generated always as identity primary key,
  device_id   text not null references public.devices(id) on delete cascade,
  ts          timestamptz not null default now(),
  score       real not null check (score between 0 and 100),
  level       text not null check (level in ('low','medium','high','critical')),
  factors     jsonb not null default '{}'::jsonb,   -- kontribusi tiap parameter terhadap skor
  source      text not null default 'rule' check (source in ('rule','ml'))
);
create index risk_device_ts_idx on public.risk_assessments (device_id, ts desc);

-- Rekomendasi tindakan (mode semi-auto) beserta statusnya
create table public.recommendations (
  id            bigint generated always as identity primary key,
  device_id     text not null references public.devices(id) on delete cascade,
  ts            timestamptz not null default now(),
  risk_id       bigint references public.risk_assessments(id) on delete set null,
  action        text not null check (action in ('relay_on','relay_off','switch_to_auto','none')),
  reason        text,
  source        text not null default 'rule' check (source in ('rule','ml')),
  status        text not null default 'pending' check (status in ('pending','executed','dismissed','expired')),
  decided_at    timestamptz
);
create index reco_device_ts_idx on public.recommendations (device_id, ts desc);

-- Perintah relay dari pengguna, rekomendasi, atau mode auto. Diantar ke ESP32 lewat MQTT/polling.
create table public.relay_commands (
  id               bigint generated always as identity primary key,
  device_id        text not null references public.devices(id) on delete cascade,
  ts               timestamptz not null default now(),
  action           text not null check (action in ('on','off')),
  source           text not null check (source in ('user','recommendation','auto')),
  recommendation_id bigint references public.recommendations(id) on delete set null,
  status           text not null default 'pending' check (status in ('pending','sent','acked','failed')),
  acked_at         timestamptz
);
create index cmd_device_ts_idx on public.relay_commands (device_id, ts desc);

-- Feedback pengguna atas rekomendasi / pemutusan otomatis; bahan evaluasi dan pelatihan ulang ML
create table public.feedback (
  id                bigint generated always as identity primary key,
  device_id         text not null references public.devices(id) on delete cascade,
  ts                timestamptz not null default now(),
  recommendation_id bigint references public.recommendations(id) on delete cascade,
  command_id        bigint references public.relay_commands(id) on delete cascade,
  appropriate       boolean not null,              -- apakah respons sistem sesuai
  comment           text,
  check (recommendation_id is not null or command_id is not null)
);

-- Ringkasan per jam untuk grafik historis
create view public.readings_hourly as
select
  device_id,
  date_trunc('hour', ts) as hour,
  avg(voltage)     as avg_voltage,
  avg(current)     as avg_current,
  avg(power)       as avg_power,
  max(power)       as max_power,
  avg(pf)          as avg_pf,
  avg(temperature) as avg_temperature,
  avg(humidity)    as avg_humidity,
  max(energy_wh) - min(energy_wh) as energy_wh_used,
  count(*)         as samples
from public.readings
group by device_id, date_trunc('hour', ts);

-- Hapus data mentah lama (data sementara). Jalankan manual atau jadwalkan via pg_cron / Supabase Cron.
create function public.purge_old_readings(keep_days int default 7)
returns bigint language sql security definer set search_path = public as $$
  with d as (delete from public.readings where ts < now() - make_interval(days => keep_days) returning 1)
  select count(*) from d;
$$;
revoke all on function public.purge_old_readings(int) from public, anon, authenticated;

-- RLS: backend menulis memakai service_role (melewati RLS). Frontend hanya boleh membaca.
-- MVP satu pengguna: anon boleh baca. Ganti ke 'authenticated' saat login ditambahkan.
alter table public.devices  enable row level security;
alter table public.readings enable row level security;
alter table public.alerts   enable row level security;
alter table public.risk_assessments enable row level security;
alter table public.recommendations  enable row level security;
alter table public.relay_commands   enable row level security;
alter table public.feedback         enable row level security;

create policy "read devices"  on public.devices  for select to anon, authenticated using (true);
create policy "read readings" on public.readings for select to anon, authenticated using (true);
create policy "read alerts"   on public.alerts   for select to anon, authenticated using (true);
create policy "read risk"     on public.risk_assessments for select to anon, authenticated using (true);
create policy "read reco"     on public.recommendations  for select to anon, authenticated using (true);
create policy "read commands" on public.relay_commands   for select to anon, authenticated using (true);
create policy "read feedback" on public.feedback         for select to anon, authenticated using (true);
-- Semua penulisan (ubah mode, kirim perintah relay, feedback) lewat backend dengan service_role,
-- setelah backend memverifikasi pengguna. Frontend tidak punya policy insert/update.

alter view public.readings_hourly set (security_invoker = true);

-- Realtime untuk frontend
alter publication supabase_realtime add table public.readings, public.alerts, public.risk_assessments, public.recommendations, public.relay_commands;

insert into public.devices (id, name, location) values ('emora-01', 'EMORA Prototype', null);
