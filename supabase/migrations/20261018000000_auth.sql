-- EMORA: akun pengguna (admin / operator), sesi login, dan PIN kontrol relai per operator.
-- Akun hanya dibuat oleh admin lewat backend. Admin pertama dibuat dengan: npm run create-admin
-- Kedua tabel hanya diakses backend (service_role): RLS aktif tanpa policy, jadi kunci publishable tidak bisa membacanya.

create table public.app_users (
  id             uuid primary key default gen_random_uuid(),
  username       text not null unique check (username ~ '^[a-z0-9._-]{3,32}$'),
  display_name   text not null check (length(display_name) between 1 and 60),
  role           text not null check (role in ('admin','operator')),
  password_hash  text not null,
  pin_hash       text,                              -- PIN 6 digit untuk ON/OFF relai (wajib untuk operator)
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.app_users(id) on delete set null,
  last_login_at  timestamptz,
  check (role <> 'operator' or pin_hash is not null)
);

create table public.app_sessions (
  token_hash  text primary key,                     -- sha256 token; token asli hanya dipegang browser
  user_id     uuid not null references public.app_users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index app_sessions_user_idx on public.app_sessions (user_id);

alter table public.app_users    enable row level security;
alter table public.app_sessions enable row level security;

-- Jejak audit: tindakan dari dashboard menyimpan id akun pelakunya.
alter table public.relay_commands add column actor_id uuid references public.app_users(id) on delete set null;
alter table public.mode_changes   add column actor_id uuid references public.app_users(id) on delete set null;
alter table public.feedback       add column actor_id uuid references public.app_users(id) on delete set null;
