-- CSL Resultater – databaseoppsett for Supabase
-- Kjør hele filen én gang i Supabase: SQL Editor -> New query -> lim inn -> Run.
-- HUSK: bytt ut e-postadressen nederst med din egen før du kjører.

-- Arrangører (de som kan importere og redigere)
create table if not exists public.admins (
  email      text primary key,
  added_at   timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- Ligaer / serier. Oppsettet (runder, løp, poengskala, divisjoner, logo) ligger i config.
create table if not exists public.leagues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  config      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Førere per liga
create table if not exists public.drivers (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references public.leagues(id) on delete cascade,
  name        text not null,
  num         text not null default '',
  div         int  not null default 1,
  cust        bigint,
  created_at  timestamptz not null default now()
);
create index if not exists drivers_league_idx on public.drivers(league_id);

-- Resultater per løp (rid = "r1-H" osv). Rader, straff og innstillinger ligger i data.
create table if not exists public.results (
  league_id   uuid not null references public.leagues(id) on delete cascade,
  rid         text not null,
  round       int  not null,
  race        text not null,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (league_id, rid)
);

-- Tilgang: alle kan lese ligaer, førere og resultater. Bare arrangører kan endre.
alter table public.admins  enable row level security;
alter table public.leagues enable row level security;
alter table public.drivers enable row level security;
alter table public.results enable row level security;

drop policy if exists "les ligaer" on public.leagues;
drop policy if exists "arrangor ligaer" on public.leagues;
create policy "les ligaer" on public.leagues for select using (true);
create policy "arrangor ligaer" on public.leagues for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "les forere" on public.drivers;
drop policy if exists "arrangor forere" on public.drivers;
create policy "les forere" on public.drivers for select using (true);
create policy "arrangor forere" on public.drivers for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "les resultater" on public.results;
drop policy if exists "arrangor resultater" on public.results;
create policy "les resultater" on public.results for select using (true);
create policy "arrangor resultater" on public.results for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "arrangor admins" on public.admins;
create policy "arrangor admins" on public.admins for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Sanntid: endringer vises direkte hos alle som har siden åpen
do $$ begin
  begin alter publication supabase_realtime add table public.leagues; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.drivers; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.results; exception when duplicate_object then null; end;
end $$;

-- Første arrangør: BYTT UT med din egen e-post
insert into public.admins (email) values (lower('DIN-EPOST@eksempel.no'))
on conflict do nothing;
