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


-- ================================================================
-- Protestsystem (samme innhold som supabase/protester.sql)
-- ================================================================

-- Stewards: kan behandle og avgjøre protester, men ikke endre oppsett eller resultater.
create table if not exists public.stewards (
  email      text primary key,
  added_at   timestamptz not null default now()
);

create or replace function public.is_steward()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_admin() or exists (
    select 1 from public.stewards
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function public.is_steward() to anon, authenticated;

-- Protestsaker. Saksnummer (no) løper per liga.
create table if not exists public.protests (
  id              uuid primary key default gen_random_uuid(),
  league_id       uuid not null references public.leagues(id) on delete cascade,
  no              int  not null,
  round           int  not null,
  race            text not null,
  by_driver       uuid references public.drivers(id) on delete set null,
  against_driver  uuid references public.drivers(id) on delete set null,
  by_name         text not null default '',
  against_name    text not null default '',
  by_num          text not null default '',
  against_num     text not null default '',
  kind            text not null default '',
  lap             int,
  replay          text not null default '',
  place           text not null default '',
  descr           text not null default '',
  video           text not null default '',
  status          text not null default 'submitted',  -- submitted, review, decided, appealed, closed
  decision        jsonb,
  appeal_by       uuid references public.drivers(id) on delete set null,
  appeal_until    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (league_id, no)
);
alter table public.protests add column if not exists by_num text not null default '';
alter table public.protests add column if not exists against_num text not null default '';
create index if not exists protests_league_idx on public.protests(league_id);

-- Sakshistorikk. private = bare stewards ser innholdet.
-- token: -1 når en protest eller anke sendes inn, +1 når den gis tilbake. Telles per fører per runde.
create table if not exists public.protest_events (
  id          bigint generated always as identity primary key,
  protest_id  uuid not null references public.protests(id) on delete cascade,
  league_id   uuid not null references public.leagues(id) on delete cascade,
  at          timestamptz not null default now(),
  kind        text not null,
  author      text not null default '',
  user_id     uuid default auth.uid(),
  by_driver   uuid references public.drivers(id) on delete set null,
  round       int,
  token       int not null default 0,
  text        text not null default '',
  video       text not null default '',
  private     boolean not null default false
);
create index if not exists protest_events_league_idx on public.protest_events(league_id);

alter table public.stewards       enable row level security;
alter table public.protests       enable row level security;
alter table public.protest_events enable row level security;

drop policy if exists "arrangor stewards" on public.stewards;
create policy "arrangor stewards" on public.stewards for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "les protester" on public.protests;
drop policy if exists "steward protester" on public.protests;
create policy "les protester"     on public.protests for select using (true);
create policy "steward protester" on public.protests for all to authenticated using (public.is_steward()) with check (public.is_steward());

drop policy if exists "les hendelser" on public.protest_events;
drop policy if exists "steward hendelser" on public.protest_events;
create policy "les hendelser"     on public.protest_events for select using (not private or public.is_steward());
create policy "steward hendelser" on public.protest_events for all to authenticated using (public.is_steward()) with check (public.is_steward());

-- Fjern den første versjonen (innlogging og kobling mellom bruker og fører)
drop function if exists public.file_protest(uuid, int, text, uuid, text, int, text, text, text, text);
drop function if exists public.protest_quota(uuid, int);
drop function if exists public.protest_reply(uuid, text, text, text);
drop function if exists public.my_driver(uuid);
drop table if exists public.driver_links;

-- Protester igjen for en fører i en runde
create or replace function public.protest_quota(p_league uuid, p_round int, p_driver uuid)
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(nullif(l.config -> 'protests' ->> 'perRound', '')::int, 2)
       + coalesce((select sum(e.token) from public.protest_events e
                   where e.league_id = p_league and e.round = p_round and e.by_driver = p_driver), 0)::int
  from public.leagues l where l.id = p_league;
$$;
grant execute on function public.protest_quota(uuid, int, uuid) to anon, authenticated;

-- Alle skriveoperasjoner fra førere går gjennom funksjonene under, som sjekker frist,
-- at førerne var med i løpet, video og antall protester.
create or replace function public.file_protest(
  p_league uuid, p_round int, p_race text, p_by uuid, p_by_num text, p_against uuid, p_against_num text,
  p_kind text, p_lap int, p_replay text, p_place text, p_descr text, p_video text)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_cfg jsonb; v_by text; v_ag text; v_rows jsonb; v_date date; v_h int; v_no int; v_id uuid;
begin
  select config into v_cfg from public.leagues where id = p_league;
  if v_cfg is null then raise exception 'Fant ikke løpsserien.'; end if;
  if coalesce((v_cfg -> 'protests' ->> 'enabled')::boolean, false) is not true then
    raise exception 'Denne løpsserien tar ikke imot protester.'; end if;
  select name into v_by from public.drivers where id = p_by and league_id = p_league;
  select name into v_ag from public.drivers where id = p_against and league_id = p_league;
  if v_by is null then raise exception 'Velg deg selv i førerlisten.'; end if;
  if v_ag is null then raise exception 'Velg føreren du protesterer mot.'; end if;
  if p_by = p_against then raise exception 'Du kan ikke protestere mot deg selv.'; end if;
  select data -> 'rows' into v_rows from public.results where league_id = p_league and rid = 'r' || p_round || '-' || p_race;
  if v_rows is null then raise exception 'Løpet har ikke noe resultat ennå.'; end if;
  if not exists (select 1 from jsonb_array_elements(v_rows) r where lower(trim(r ->> 'name')) = lower(trim(v_by))) then
    raise exception '% var ikke med i dette løpet.', v_by; end if;
  if not exists (select 1 from jsonb_array_elements(v_rows) r where lower(trim(r ->> 'name')) = lower(trim(v_ag))) then
    raise exception '% var ikke med i dette løpet.', v_ag; end if;
  v_date := nullif(v_cfg -> 'rounds' -> (p_round - 1) ->> 'date', '')::date;
  v_h := coalesce(nullif(v_cfg -> 'protests' ->> 'deadlineH', '')::int, 48);
  if v_date is not null and now() > ((v_date + 1)::timestamp at time zone 'Europe/Oslo') + make_interval(hours => v_h) then
    raise exception 'Protestfristen for denne runden har gått ut.'; end if;
  if coalesce(v_cfg -> 'protests' ->> 'video', 'req') = 'req' and coalesce(trim(p_video), '') !~* '^https?://' then
    raise exception 'Legg ved en lenke til video (YouTube, Streamable e.l.).'; end if;
  if coalesce(trim(p_descr), '') = '' then raise exception 'Skriv en kort beskrivelse av hendelsen.'; end if;
  if public.protest_quota(p_league, p_round, p_by) <= 0 then
    raise exception '% har ingen protester igjen i denne runden.', v_by; end if;

  perform pg_advisory_xact_lock(hashtext(p_league::text));
  select coalesce(max(no), 0) + 1 into v_no from public.protests where league_id = p_league;
  insert into public.protests (league_id, no, round, race, by_driver, against_driver, by_name, against_name, by_num, against_num,
                               kind, lap, replay, place, descr, video)
  values (p_league, v_no, p_round, p_race, p_by, p_against, v_by, v_ag, left(coalesce(p_by_num, ''), 10), left(coalesce(p_against_num, ''), 10),
          left(coalesce(p_kind, ''), 80), p_lap, left(coalesce(p_replay, ''), 20), left(coalesce(p_place, ''), 80),
          left(p_descr, 4000), left(coalesce(trim(p_video), ''), 500))
  returning id into v_id;
  insert into public.protest_events (protest_id, league_id, kind, author, by_driver, round, token, text, video)
  values (v_id, p_league, 'submitted', v_by, p_by, p_round, -1, left(p_descr, 4000), left(coalesce(trim(p_video), ''), 500));
  return v_no;
end;
$$;
grant execute on function public.file_protest(uuid, int, text, uuid, text, uuid, text, text, int, text, text, text, text) to anon, authenticated;

-- Svar eller nytt bevis før avgjørelsen (gratis, bare stewards ser det),
-- eller anke etter avgjørelsen (koster én protest, vises i sakshistorikken).
-- p_driver må være en av de to førerne i saken.
create or replace function public.protest_reply(p_protest uuid, p_driver uuid, p_kind text, p_text text, p_video text)
returns void
language plpgsql security definer set search_path = public
as $$
declare p public.protests; v_name text;
begin
  select * into p from public.protests where id = p_protest;
  if p.id is null then raise exception 'Fant ikke saken.'; end if;
  if p_driver is null or p_driver not in (p.by_driver, p.against_driver) then
    raise exception 'Bare førerne i saken kan svare eller anke.'; end if;
  if coalesce(trim(p_text), '') = '' then raise exception 'Skriv en tekst.'; end if;
  select name into v_name from public.drivers where id = p_driver;
  if p_kind = 'response' then
    if p.status not in ('submitted', 'review', 'appealed') then
      raise exception 'Saken er avgjort. Du kan anke i stedet.'; end if;
    insert into public.protest_events (protest_id, league_id, kind, author, by_driver, round, token, text, video, private)
    values (p.id, p.league_id, 'response', v_name, p_driver, p.round, 0, left(p_text, 4000), left(coalesce(trim(p_video), ''), 500), true);
  elsif p_kind = 'appeal' then
    if p.status <> 'decided' then raise exception 'Bare avgjorte saker kan ankes.'; end if;
    if p.appeal_until is null then raise exception 'Denne avgjørelsen kan ikke ankes.'; end if;
    if now() > p.appeal_until then raise exception 'Ankefristen har gått ut.'; end if;
    if public.protest_quota(p.league_id, p.round, p_driver) <= 0 then
      raise exception '% har ingen protester igjen i denne runden. En anke koster én.', v_name; end if;
    update public.protests set status = 'appealed', appeal_by = p_driver, updated_at = now() where id = p.id;
    insert into public.protest_events (protest_id, league_id, kind, author, by_driver, round, token, text, video)
    values (p.id, p.league_id, 'appeal', v_name, p_driver, p.round, -1, left(p_text, 4000), left(coalesce(trim(p_video), ''), 500));
  else
    raise exception 'Ukjent type.';
  end if;
end;
$$;
grant execute on function public.protest_reply(uuid, uuid, text, text, text) to anon, authenticated;

-- Sanntid
do $$ begin
  begin alter publication supabase_realtime add table public.protests; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.protest_events; exception when duplicate_object then null; end;
end $$;


-- ================================================================
-- Passord for brukere (samme innhold som supabase/passord.sql)
-- ================================================================

create extension if not exists pgcrypto with schema extensions;

-- Setter nytt passord på kontoen med denne e-posten og bekrefter e-posten.
-- Gir false hvis kontoen ikke finnes. Bare arrangører (admins) kan bruke den.
create or replace function public.admin_set_password(p_email text, p_password text)
returns boolean
language plpgsql security definer set search_path = public, extensions, auth
as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Bare arrangører kan sette passord.'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Passordet må ha minst 8 tegn.'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where lower(email) = lower(trim(p_email));
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function public.admin_set_password(text, text) from public, anon;
grant execute on function public.admin_set_password(text, text) to authenticated;
