-- Admin role: server-side identity check + narrow read-only RLS extensions.
--
-- Design:
--   * is_admin() is a SECURITY DEFINER SQL function pinned to the public
--     search_path. It reads auth.jwt()->>'email' and compares against an
--     in-function allowlist. One place to change admin membership; no
--     separate admin_users table while the list is small.
--   * Existing RLS policies stay strictly owner/member-scoped. We add a
--     parallel "admin_select_*" policy on each table the admin needs to
--     read across all users. SELECT-only — no admin INSERT/UPDATE/DELETE
--     policies; day-one admin is read-only.
--   * profiles is added to the supabase_realtime publication so the admin
--     dashboard can observe new signups live (the handle_new_user trigger
--     inserts a profile row for every auth.users row).
--
-- Safety: the Edge Function still does its own is_admin() check and uses
-- the service-role key for queries. These RLS policies are the secondary
-- defense — if someone ever queries these tables as the admin user via
-- the anon key (e.g., Realtime), they only see what policy allows.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (auth.jwt() ->> 'email') in (
      'blangholz@gmail.com'
    ),
    false
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Admin SELECT policies. One per table. Each is additive to the existing
-- owner/member policies — Postgres RLS is OR across policies of the same
-- command, so admin gets read access without weakening anything else.

drop policy if exists "profiles_admin_select" on public.profiles;
create policy "profiles_admin_select" on public.profiles
  for select to authenticated using (public.is_admin());

drop policy if exists "gear_admin_select" on public.gear;
create policy "gear_admin_select" on public.gear
  for select to authenticated using (public.is_admin());

drop policy if exists "activities_admin_select" on public.activities;
create policy "activities_admin_select" on public.activities
  for select to authenticated using (public.is_admin());

drop policy if exists "activity_items_admin_select" on public.activity_items;
create policy "activity_items_admin_select" on public.activity_items
  for select to authenticated using (public.is_admin());

drop policy if exists "activity_members_admin_select" on public.activity_members;
create policy "activity_members_admin_select" on public.activity_members
  for select to authenticated using (public.is_admin());

drop policy if exists "custom_filters_admin_select" on public.custom_filters;
create policy "custom_filters_admin_select" on public.custom_filters
  for select to authenticated using (public.is_admin());

-- Ensure profiles is in the supabase_realtime publication so the admin
-- dashboard can see live new-signup events (handle_new_user inserts a
-- profile row for every new auth.users row).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    execute 'alter publication supabase_realtime add table public.profiles';
  end if;
end $$;

alter table public.profiles replica identity full;
