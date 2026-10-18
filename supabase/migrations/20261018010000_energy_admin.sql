-- EMORA: ringkasan energi harian/per jam dari data asli, tarif listrik, dan rekomendasi harian dari admin.

-- Tarif listrik per device (diatur admin dari halaman Admin dashboard, ditulis lewat backend).
-- Biaya = kWh x tariff_per_kwh x (1 + tax_percent/100). tax_percent untuk PPJ / pajak daerah.
alter table public.devices
  add column tariff_class   text not null default 'R-1/1.300 VA',
  add column tariff_per_kwh real not null default 1444.70 check (tariff_per_kwh > 0),
  add column tax_percent    real not null default 0 check (tax_percent between 0 and 30);

-- Rekomendasi harian, diisi admin. Dashboard menampilkan rekomendasi untuk tanggal hari ini.
create table public.daily_tips (
  id                 bigint generated always as identity primary key,
  device_id          text not null references public.devices(id) on delete cascade,
  day                date not null,                                  -- tanggal berlaku (WIB)
  title              text not null check (char_length(title) between 1 and 120),
  body               text not null default '' check (char_length(body) <= 1000),
  saving_kwh_per_day real check (saving_kwh_per_day >= 0),            -- perkiraan hemat; rupiah dihitung dari tarif
  created_by         text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index daily_tips_device_day_idx on public.daily_tips (device_id, day desc);
alter table public.daily_tips enable row level security;
create policy "read daily tips" on public.daily_tips for select to anon, authenticated using (true);
alter publication supabase_realtime add table public.daily_tips;

-- Ringkasan per jam / per hari (WIB) untuk halaman Energi.
-- Energi diambil dari counter kumulatif PZEM (energy_wh), bukan integrasi daya, sehingga energi selama
-- ESP32 offline tetap terhitung saat data berikutnya masuk. Pembacaan di luar rentang ukur PZEM-004T v3
-- (glitch komunikasi serial) diabaikan. Counter yang di-reset (turun) dihitung mulai dari nilai barunya.
create function public.energy_buckets(
  p_device text,
  p_from   timestamptz,
  p_to     timestamptz,
  p_bucket text default 'day'
)
returns table (
  bucket    timestamptz,
  energy_wh double precision,
  v_avg     double precision,
  v_min     double precision,
  v_max     double precision,
  pf_avg    double precision,
  p_avg     double precision,
  p_max     double precision,
  i_max     double precision,
  samples   bigint
)
language sql stable
set search_path = public
as $$
  with r as (
    select ts, voltage, current, power, pf, energy_wh
    from readings
    where device_id = p_device
      and ts >= p_from - interval '6 hours'   -- pembacaan sebelumnya, untuk selisih counter pertama
      and ts < p_to
      and p_to - p_from <= interval '93 days'
      and voltage between 80 and 300            -- PZEM-004T v3 hanya mengukur 80–260 V; di bawahnya = colok/cabut
      and current between 0 and 100
      and power between 0 and 23000
      and (pf is null or pf between 0 and 1)
      and (frequency is null or frequency between 40 and 70)
      and (energy_wh is null or energy_wh between 0 and 10000000)
  ),
  d as (
    select r.*,
      energy_wh - lag(energy_wh) over w as de,
      extract(epoch from ts - lag(ts) over w) / 3600.0 as dt_h
    from r
    window w as (order by ts)
  )
  select
    date_trunc(case when p_bucket = 'hour' then 'hour' else 'day' end, ts at time zone 'Asia/Jakarta')
      at time zone 'Asia/Jakarta' as bucket,
    coalesce(sum(
      case
        when de is null then 0
        -- batas 23 kW (maks. PZEM) x lama jeda + 2 Wh pembulatan: lompatan di atas ini dianggap glitch
        when de >= 0 and de <= 23000 * dt_h + 2 then de
        when de < 0 and energy_wh <= 23000 * dt_h + 2 then energy_wh
        else 0
      end), 0)::double precision as energy_wh,
    avg(voltage)::double precision,
    min(voltage)::double precision,
    max(voltage)::double precision,
    (avg(pf) filter (where power >= 1))::double precision,   -- PF hanya bermakna saat ada beban
    avg(power)::double precision,
    max(power)::double precision,
    max(current)::double precision,
    count(*)
  from d
  where ts >= p_from
  group by 1
  order by 1
$$;
grant execute on function public.energy_buckets(text, timestamptz, timestamptz, text) to anon, authenticated;

-- Grafik 30 hari butuh data mentah 30 hari: retensi bawaan dinaikkan dari 7 ke 40 hari.
create or replace function public.purge_old_readings(keep_days int default 40)
returns bigint language sql security definer set search_path = public as $$
  with d as (delete from public.readings where ts < now() - make_interval(days => keep_days) returning 1)
  select count(*) from d;
$$;
revoke all on function public.purge_old_readings(int) from public, anon, authenticated;
