-- Commute Pain Tracker schema. Run once in Supabase → SQL Editor.
-- Only server code (logger + Next.js) talks to the DB, using the service key.
-- RLS is on with no policies, so anon/public keys can read nothing.

create table if not exists users (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (name ~ '^[A-Za-z0-9_]{2,20}$'),
  pin_hash     text not null,                -- scrypt, see lib/auth.ts
  failed_pins  integer not null default 0,
  locked_until timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists users_name_ci on users (lower(name));

create table if not exists routes (
  id           bigint generated always as identity primary key,
  slug         text not null unique,
  name         text not null,
  owner_id     uuid references users(id) on delete cascade,  -- null = community seed route
  origin_label text,
  dest_label   text,
  origin_lat   double precision not null,
  origin_lng   double precision not null,
  dest_lat     double precision not null,
  dest_lng     double precision not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists commute_logs (
  id                bigint generated always as identity primary key,
  route_id          bigint not null references routes(id) on delete cascade,
  duration_sec      integer not null check (duration_sec > 0),
  traffic_delay_sec integer not null default 0,
  distance_m        integer not null,
  alternatives      jsonb not null default '[]',  -- [{duration_sec, distance_m}] from TomTom maxAlternatives
  logged_at         timestamptz not null default now()  -- UTC; UI shows IST
);
create index if not exists commute_logs_route_time on commute_logs (route_id, logged_at desc);

create table if not exists radio_messages (
  id         bigint generated always as identity primary key,
  route_id   bigint not null references routes(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  kind       text not null check (kind in ('text', 'voice')),
  body       text check (char_length(body) <= 140),
  audio_path text,
  created_at timestamptz not null default now()
);
create index if not exists radio_route_id on radio_messages (route_id, id desc);
create index if not exists radio_user_time on radio_messages (user_id, created_at desc);

-- Median minutes per route × IST weekday (0=Mon) × half-hour slot (0..47), last 8 weeks.
create or replace view slot_stats as
select
  route_id,
  extract(isodow from logged_at at time zone 'Asia/Kolkata')::int - 1 as dow,
  extract(hour   from logged_at at time zone 'Asia/Kolkata')::int * 2
    + (extract(minute from logged_at at time zone 'Asia/Kolkata') >= 30)::int as slot,
  round((percentile_cont(0.5) within group (order by duration_sec) / 60.0)::numeric, 1)::float as median_min,
  count(*)::int as n
from commute_logs
where logged_at > now() - interval '8 weeks'
group by 1, 2, 3;

create or replace view latest_logs as
select distinct on (route_id) route_id, duration_sec, traffic_delay_sec, distance_m, alternatives, logged_at
from commute_logs
order by route_id, logged_at desc;

alter table users          enable row level security;
alter table routes         enable row level security;
alter table commute_logs   enable row level security;
alter table radio_messages enable row level security;
revoke all on users, routes, commute_logs, radio_messages, slot_stats, latest_logs from anon, authenticated;

-- Private bucket for push-to-talk clips (served via short-lived signed URLs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('radio', 'radio', false, 400000, array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac'])
on conflict (id) do nothing;

-- Community seed routes (fix coordinates in Table Editor anytime).
insert into routes (slug, name, origin_label, dest_label, origin_lat, origin_lng, dest_lat, dest_lng) values
  ('gachibowli-ameerpet',             'Gachibowli→Ameerpet',             'Gachibowli',         'Ameerpet',      17.4401, 78.3489, 17.4375, 78.4483),
  ('hitec-city-kukatpally',           'HITEC City→Kukatpally',           'HITEC City',         'Kukatpally',    17.4474, 78.3762, 17.4849, 78.4138),
  ('financial-district-secunderabad', 'Financial District→Secunderabad', 'Financial District', 'Secunderabad',  17.4156, 78.3410, 17.4399, 78.4983),
  ('madhapur-lb-nagar',               'Madhapur→LB Nagar',               'Madhapur',           'LB Nagar',      17.4483, 78.3915, 17.3457, 78.5522),
  ('kondapur-miyapur',                'Kondapur→Miyapur',                'Kondapur',           'Miyapur',       17.4600, 78.3570, 17.4968, 78.3614),
  ('raidurg-banjara-hills',           'Raidurg→Banjara Hills',           'Raidurg',            'Banjara Hills', 17.4270, 78.3810, 17.4156, 78.4347)
on conflict (slug) do nothing;
