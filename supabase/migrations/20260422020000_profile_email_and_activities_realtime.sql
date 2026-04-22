-- 1) Add email to profiles so co-members can fall back to an email prefix
--    when a member hasn't picked a display name yet.
-- 2) Populate email on new-user signup (trigger).
-- 3) Backfill email for existing profile rows.
-- 4) Add the activities table to supabase_realtime so renames/deletes
--    propagate to other members without a refresh.

alter table public.profiles add column if not exists email text;

create index if not exists profiles_email_idx on public.profiles (email);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email
  where public.profiles.email is null;
  return new;
end;
$$;

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id
  and p.email is null
  and u.email is not null;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activities'
  ) then
    execute 'alter publication supabase_realtime add table public.activities';
  end if;
end $$;
