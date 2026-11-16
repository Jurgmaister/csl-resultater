-- CSL Resultater – arrangører kan sette passord på brukere
-- Kjør hele filen én gang i Supabase: SQL Editor -> New query -> lim inn -> Run.
-- Filen kan kjøres flere ganger. Den er også tatt med nederst i schema.sql.

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
