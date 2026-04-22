-- Per-user unread tracking + re-engagement digest infrastructure.
--
-- Adds:
--   1. activity_items.added_by — who added each item (so we can tell "new
--      from someone else" apart from "I added this myself").
--   2. activity_views — per-user, per-activity (last_seen_at, digest_sent_at)
--      so the client can show an unread badge and the cron can decide who
--      to email.
--   3. mark_activity_seen(uuid) — RPC the client calls when the user opens
--      a tab; upserts last_seen_at = now().
--   4. internal_digest_candidates() / internal_mark_digest_sent() —
--      service-role-only helpers used by the digest-emails edge function.
--
-- Re-engagement rule (computed by internal_digest_candidates):
--   For each (member, activity), if there are items added by OTHER members
--   newer than the member's last_seen_at AND newer than digest_sent_at, AND
--   the member hasn't viewed in the past 24 hours, return one row.

-- ---------------------------------------------------------------------------
-- 1. activity_items.added_by
-- ---------------------------------------------------------------------------
alter table public.activity_items
  add column if not exists added_by uuid references auth.users(id) on delete set null
    default auth.uid();

-- Backfill: pre-sharing rows were all created by the activity owner.
update public.activity_items ai
  set added_by = a.owner_id
  from public.activities a
  where ai.activity_id = a.id and ai.added_by is null;

-- Used by the unread-count query below.
create index if not exists activity_items_added_by_created_idx
  on public.activity_items (activity_id, added_by, created_at);

-- ---------------------------------------------------------------------------
-- 2. activity_views
-- ---------------------------------------------------------------------------
create table if not exists public.activity_views (
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  digest_sent_at timestamptz,
  primary key (user_id, activity_id)
);

create index if not exists activity_views_activity_idx on public.activity_views (activity_id);

alter table public.activity_views enable row level security;

-- A user can see / write their own view rows. Membership is enforced by the
-- mark_activity_seen RPC (it checks activity_members before upserting).
create policy "activity_views_select_own" on public.activity_views
  for select to authenticated using (user_id = auth.uid());
create policy "activity_views_insert_own" on public.activity_views
  for insert to authenticated with check (user_id = auth.uid());
create policy "activity_views_update_own" on public.activity_views
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. mark_activity_seen — client RPC
-- ---------------------------------------------------------------------------
create or replace function public.mark_activity_seen(p_activity_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Belt-and-suspenders membership check (RLS would also block, but the
  -- error is clearer this way).
  if not exists (
    select 1 from public.activity_members
    where activity_id = p_activity_id and user_id = auth.uid()
  ) then
    raise exception 'not a member of this activity';
  end if;

  insert into public.activity_views (user_id, activity_id, last_seen_at)
  values (auth.uid(), p_activity_id, now())
  on conflict (user_id, activity_id) do update
    set last_seen_at = excluded.last_seen_at;
end $$;

grant execute on function public.mark_activity_seen(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Digest helpers (service-role only)
-- ---------------------------------------------------------------------------
-- Returns one row per (user, activity) where re-engagement is warranted.
-- "Baseline" = max(last_seen_at, digest_sent_at, member.joined_at):
--   * last_seen_at: don't re-notify about items they've already seen
--   * digest_sent_at: don't re-notify about items the previous digest covered
--   * joined_at: don't surface items from before they joined
-- Eligible if: at least one item from another member is newer than baseline,
-- AND the member hasn't visited the activity in the past 24 hours.
create or replace function public.internal_digest_candidates()
returns table (
  user_id uuid,
  email text,
  display_name text,
  activity_id uuid,
  activity_name text,
  activity_emoji text,
  new_count bigint,
  latest_item_at timestamptz,
  baseline timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with baselines as (
    select
      am.user_id,
      am.activity_id,
      am.joined_at,
      av.last_seen_at,
      av.digest_sent_at,
      greatest(
        am.joined_at,
        coalesce(av.last_seen_at, am.joined_at),
        coalesce(av.digest_sent_at, am.joined_at)
      ) as baseline
    from public.activity_members am
    left join public.activity_views av
      on av.user_id = am.user_id and av.activity_id = am.activity_id
  ),
  new_items as (
    select
      b.user_id,
      b.activity_id,
      b.baseline,
      b.last_seen_at,
      count(ai.id) as new_count,
      max(ai.created_at) as latest_item_at
    from baselines b
    join public.activity_items ai
      on ai.activity_id = b.activity_id
      and ai.added_by is not null
      and ai.added_by <> b.user_id
      and ai.created_at > b.baseline
    group by b.user_id, b.activity_id, b.baseline, b.last_seen_at
    having count(ai.id) > 0
  )
  select
    u.id as user_id,
    u.email::text as email,
    coalesce(p.display_name, '') as display_name,
    a.id as activity_id,
    a.name as activity_name,
    coalesce(a.emoji, '') as activity_emoji,
    n.new_count,
    n.latest_item_at,
    n.baseline
  from new_items n
  join auth.users u on u.id = n.user_id
  join public.activities a on a.id = n.activity_id
  left join public.profiles p on p.id = n.user_id
  where u.email is not null
    -- Don't badger people who are actively using the app: only digest if
    -- they haven't viewed in the past 24h.
    and coalesce(n.last_seen_at, '-infinity'::timestamptz) < now() - interval '24 hours';
$$;

revoke all on function public.internal_digest_candidates() from public, anon, authenticated;

-- Mark digest_sent_at = now() after the email has been sent. Service-role
-- only; called by the digest-emails edge function.
create or replace function public.internal_mark_digest_sent(p_user_id uuid, p_activity_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.activity_views (user_id, activity_id, last_seen_at, digest_sent_at)
  values (p_user_id, p_activity_id, '-infinity'::timestamptz, now())
  on conflict (user_id, activity_id) do update
    set digest_sent_at = excluded.digest_sent_at;
end $$;

revoke all on function public.internal_mark_digest_sent(uuid, uuid) from public, anon, authenticated;
