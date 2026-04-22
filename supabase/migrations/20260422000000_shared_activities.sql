-- Shared, collaborative packing lists.
--
-- Turns single-owner activities into multi-user shared lists. Any member can
-- read + write items and filters; only the activity owner can kick members,
-- cancel invites, or delete the activity. Gear stays per-user in the library,
-- but once a gear row is added to a shared list, co-members can read that
-- gear row (necessary to render the row). Profiles become co-visible between
-- members so we can show display names.
--
-- Invites for emails that don't yet have an account are held in
-- activity_invites with a random token; the share-activity Edge Function
-- sends the styled invite email.

-- pgcrypto provides gen_random_bytes() used as the invite token default.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- activity_members: who can access which activity
-- ---------------------------------------------------------------------------
create table public.activity_members (
  activity_id uuid not null references public.activities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (activity_id, user_id)
);

create index activity_members_user_idx on public.activity_members (user_id);

alter table public.activity_members enable row level security;

-- SELECT: you can see your own membership row, plus membership rows for any
-- activity you are a member of (so we can render the "N members" list).
create policy "activity_members_select_self_or_comember" on public.activity_members
  for select to authenticated using (
    user_id = auth.uid()
    or exists (
      select 1 from public.activity_members m
      where m.activity_id = activity_members.activity_id
        and m.user_id = auth.uid()
    )
  );

-- INSERT: only the activity owner can add members. The auto-enroll trigger
-- below also inserts the creator as owner — it runs as SECURITY DEFINER so
-- the policy doesn't need to cover that case.
create policy "activity_members_insert_by_owner" on public.activity_members
  for insert to authenticated with check (
    exists (
      select 1 from public.activities a
      where a.id = activity_members.activity_id and a.owner_id = auth.uid()
    )
  );

-- UPDATE: only the owner can change roles.
create policy "activity_members_update_by_owner" on public.activity_members
  for update to authenticated using (
    exists (
      select 1 from public.activities a
      where a.id = activity_members.activity_id and a.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.activities a
      where a.id = activity_members.activity_id and a.owner_id = auth.uid()
    )
  );

-- DELETE: a user can always remove themselves (leave), and the owner can
-- remove anyone except themselves.
create policy "activity_members_delete_self_or_kicked" on public.activity_members
  for delete to authenticated using (
    (user_id = auth.uid() and role <> 'owner')
    or (
      role <> 'owner'
      and exists (
        select 1 from public.activities a
        where a.id = activity_members.activity_id and a.owner_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Helper: is the current auth user a member of this activity?
--
-- SECURITY DEFINER bypasses RLS on activity_members, avoiding recursion when
-- other tables' policies reference this function. stable + pinned search_path
-- per Supabase security-advisor recommendations.
-- ---------------------------------------------------------------------------
create or replace function public.is_activity_member(aid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.activity_members
    where activity_id = aid and user_id = auth.uid()
  );
$$;

revoke all on function public.is_activity_member(uuid) from public;
grant execute on function public.is_activity_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Auto-enroll the creator as owner on activity insert.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.activity_members (activity_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (activity_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_activity_created on public.activities;
create trigger on_activity_created
  after insert on public.activities
  for each row execute function public.handle_new_activity();

-- Backfill memberships for any activities that already exist. Idempotent.
insert into public.activity_members (activity_id, user_id, role)
select id, owner_id, 'owner'
from public.activities
on conflict (activity_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Prevent owner_id changes on activities. Ownership transfer isn't in v1.
-- Without this, any member could UPDATE owner_id since the new members-can-
-- update policy below doesn't restrict columns.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_activity_owner_change()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'activities.owner_id is immutable';
  end if;
  return new;
end;
$$;

alter function public.prevent_activity_owner_change() set search_path = public, pg_temp;

create trigger activities_immutable_owner
  before update on public.activities
  for each row execute function public.prevent_activity_owner_change();

-- ---------------------------------------------------------------------------
-- activity_invites: pending email invites
--
-- When a user invites an email that doesn't match any auth.users row, we
-- stash it here with a random token. The share-activity Edge Function emails
-- the invitee a Supabase-generated invite link that carries the token in the
-- redirect URL; accept-invite consumes the token and promotes the row into
-- activity_members.
-- ---------------------------------------------------------------------------
create table public.activity_invites (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  email text not null,
  invited_by uuid not null references auth.users(id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'base64'),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create index activity_invites_activity_idx on public.activity_invites (activity_id);
create unique index activity_invites_activity_email_pending_idx
  on public.activity_invites (activity_id, lower(email))
  where accepted_at is null;

alter table public.activity_invites enable row level security;

-- SELECT/INSERT/UPDATE/DELETE on invites: only the activity owner manages
-- them from the client. Invite *acceptance* goes through the accept-invite
-- Edge Function, which uses the service role and bypasses these policies.
create policy "activity_invites_select_owner" on public.activity_invites
  for select to authenticated using (
    exists (
      select 1 from public.activities a
      where a.id = activity_invites.activity_id and a.owner_id = auth.uid()
    )
  );

create policy "activity_invites_insert_owner" on public.activity_invites
  for insert to authenticated with check (
    invited_by = auth.uid()
    and exists (
      select 1 from public.activities a
      where a.id = activity_invites.activity_id and a.owner_id = auth.uid()
    )
  );

create policy "activity_invites_update_owner" on public.activity_invites
  for update to authenticated using (
    exists (
      select 1 from public.activities a
      where a.id = activity_invites.activity_id and a.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.activities a
      where a.id = activity_invites.activity_id and a.owner_id = auth.uid()
    )
  );

create policy "activity_invites_delete_owner" on public.activity_invites
  for delete to authenticated using (
    exists (
      select 1 from public.activities a
      where a.id = activity_invites.activity_id and a.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Expand existing RLS so members (not just owners) can read/write.
--
-- We drop and recreate the affected policies. The "owner-only" SELECT/UPDATE
-- behaviours are replaced with "member" variants; INSERT stays owner-only on
-- activities themselves; DELETE on activities stays owner-only; DELETE on
-- activity_items requires gear-owner OR activity-owner (so a random member
-- can't nuke someone else's contribution).
-- ---------------------------------------------------------------------------

-- activities --------------------------------------------------------------
drop policy if exists "activities_select_own" on public.activities;
drop policy if exists "activities_update_own" on public.activities;

create policy "activities_select_member" on public.activities
  for select to authenticated using (public.is_activity_member(id));

create policy "activities_update_member" on public.activities
  for update to authenticated using (public.is_activity_member(id))
  with check (public.is_activity_member(id));

-- custom_filters ----------------------------------------------------------
drop policy if exists "custom_filters_select_own" on public.custom_filters;
drop policy if exists "custom_filters_insert_own" on public.custom_filters;
drop policy if exists "custom_filters_update_own" on public.custom_filters;
drop policy if exists "custom_filters_delete_own" on public.custom_filters;

create policy "custom_filters_select_member" on public.custom_filters
  for select to authenticated using (public.is_activity_member(activity_id));

create policy "custom_filters_insert_member" on public.custom_filters
  for insert to authenticated with check (public.is_activity_member(activity_id));

create policy "custom_filters_update_member" on public.custom_filters
  for update to authenticated using (public.is_activity_member(activity_id))
  with check (public.is_activity_member(activity_id));

create policy "custom_filters_delete_member" on public.custom_filters
  for delete to authenticated using (public.is_activity_member(activity_id));

-- activity_items ----------------------------------------------------------
drop policy if exists "activity_items_select_own" on public.activity_items;
drop policy if exists "activity_items_insert_own" on public.activity_items;
drop policy if exists "activity_items_update_own" on public.activity_items;
drop policy if exists "activity_items_delete_own" on public.activity_items;

create policy "activity_items_select_member" on public.activity_items
  for select to authenticated using (public.is_activity_member(activity_id));

-- INSERT: any member can add items, but only with their OWN gear. This
-- prevents "add a fake item referencing someone else's gear" attacks.
create policy "activity_items_insert_member_own_gear" on public.activity_items
  for insert to authenticated with check (
    public.is_activity_member(activity_id)
    and exists (
      select 1 from public.gear g
      where g.id = activity_items.gear_id and g.owner_id = auth.uid()
    )
  );

-- UPDATE: any member can edit packed/quantity/note/tags/position/custom_filter_ids
-- on any row. Postgres RLS can't restrict this to non-identity columns, but
-- the uniqueness constraint on (activity_id, gear_id) plus the gear-must-be-
-- yours INSERT rule means flipping gear_id to something else would collide or
-- fail the insert-equivalent check. We don't add extra guardrails here — the
-- attack surface is "a trusted member being sneaky" and the worst they can
-- do is swap to gear they own, which is fine.
create policy "activity_items_update_member" on public.activity_items
  for update to authenticated using (public.is_activity_member(activity_id))
  with check (public.is_activity_member(activity_id));

-- DELETE: gear-owner OR activity-owner. Prevents non-owners from removing
-- items contributed by other members.
create policy "activity_items_delete_contributor_or_owner" on public.activity_items
  for delete to authenticated using (
    exists (
      select 1 from public.gear g
      where g.id = activity_items.gear_id and g.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.activities a
      where a.id = activity_items.activity_id and a.owner_id = auth.uid()
    )
  );

-- gear --------------------------------------------------------------------
-- Expand SELECT: a user can read their own gear rows, plus any gear row that
-- is currently referenced by an activity_item belonging to an activity they
-- are a member of. This is what lets Alice render Ben's tent details on a
-- shared list. INSERT/UPDATE/DELETE stay owner-only — nobody can modify
-- someone else's gear library.
drop policy if exists "gear_select_own" on public.gear;

create policy "gear_select_own_or_shared" on public.gear
  for select to authenticated using (
    owner_id = auth.uid()
    or exists (
      select 1
      from public.activity_items ai
      where ai.gear_id = gear.id
        and public.is_activity_member(ai.activity_id)
    )
  );

-- profiles ----------------------------------------------------------------
-- Expand SELECT: members of a shared activity can see each other's basic
-- profile (so we can render display_name + initial). We don't widen UPDATE/
-- DELETE — those stay self-only.
drop policy if exists "profiles_select_own" on public.profiles;

create policy "profiles_select_own_or_comember" on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or exists (
      select 1
      from public.activity_members mine
      join public.activity_members theirs on theirs.activity_id = mine.activity_id
      where mine.user_id = auth.uid()
        and theirs.user_id = profiles.id
    )
  );

-- ---------------------------------------------------------------------------
-- Service-role-only helper: look up a user id by email (case-insensitive).
-- Used by the share-activity Edge Function to decide whether to add a member
-- directly or generate an invite. Explicitly NOT exposed to authenticated
-- callers to prevent email enumeration.
-- ---------------------------------------------------------------------------
create or replace function public.internal_lookup_user_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

revoke all on function public.internal_lookup_user_by_email(text) from public;
revoke all on function public.internal_lookup_user_by_email(text) from anon;
revoke all on function public.internal_lookup_user_by_email(text) from authenticated;
grant execute on function public.internal_lookup_user_by_email(text) to service_role;

-- ---------------------------------------------------------------------------
-- Enable realtime on the three tables the active-activity channel subscribes
-- to. activity_items for packing-list updates, activity_members for the
-- share-modal member list, custom_filters for filter-chip updates.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.activity_items;
alter publication supabase_realtime add table public.activity_members;
alter publication supabase_realtime add table public.custom_filters;
