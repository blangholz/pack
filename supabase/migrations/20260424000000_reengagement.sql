-- Re-engagement stack: server-side intent table + sent-log + candidate RPC.
--
-- Pairs with:
--   * supabase/functions/record-share-intent — writes intents on landing submit.
--   * supabase/functions/reengagement-emails — the daily cron worker.
--   * api/cron-reengagement.js (Vercel) — triggers the edge function.
--
-- Three strands re-engaged:
--   A — auth.users row exists, email_confirmed_at is null (never clicked link).
--   B — signed in, never ended up on the intended activity.
--   C — invited by email, never registered.

-- ---------------------------------------------------------------------------
-- share_link_signup_intents
--
-- Landing-page form records (email, activity, token) here when a visitor
-- submits the share-landing flow. When that email later signs in on ANY
-- device, onSignedIn reads this row and auto-accepts — fixes the
-- cross-device failure mode where the localStorage autoAccept flag is on
-- the wrong browser.
--
-- One row per email: if the same email submits for a different list later,
-- upsert replaces the prior intent. No RLS — the record-share-intent and
-- reengagement-emails edge functions both run with the service role; the
-- client never reads this table directly.
-- ---------------------------------------------------------------------------
create table public.share_link_signup_intents (
  email text primary key,
  activity_id uuid not null references public.activities(id) on delete cascade,
  token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index share_link_signup_intents_activity_idx
  on public.share_link_signup_intents (activity_id);

alter table public.share_link_signup_intents enable row level security;
-- Deliberately no policies — lockdown by default. Edge functions use the
-- service role which bypasses RLS.

-- ---------------------------------------------------------------------------
-- reengagement_sent
--
-- Dedupe log for strands A and B. One row per (user, activity, strand) once
-- we've sent the follow-up email. The candidate RPC filters out anything
-- already in this table.
--
-- Strand C uses a column on activity_invites instead (see below) because the
-- recipient doesn't yet have an auth.users row.
-- ---------------------------------------------------------------------------
create table public.reengagement_sent (
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  strand text not null check (strand in ('A', 'B')),
  sent_at timestamptz not null default now(),
  primary key (user_id, activity_id, strand)
);

alter table public.reengagement_sent enable row level security;
-- No policies: service-role only.

-- ---------------------------------------------------------------------------
-- activity_invites.reengagement_sent_at — strand C dedupe column.
-- Separate from reengagement_sent because strand-C recipients have no
-- auth.users row; the invite row itself is the recipient key.
-- ---------------------------------------------------------------------------
alter table public.activity_invites
  add column if not exists reengagement_sent_at timestamptz;

-- ---------------------------------------------------------------------------
-- internal_reengagement_candidates()
--
-- Returns one row per (strand, recipient, activity) that should receive a
-- re-engagement email. Shape is uniform across strands so the edge function
-- can loop over a single list and branch on the strand column.
--
-- Filters:
--   * Strand A/B: created_at on the intent row is > 24h ago AND no
--     reengagement_sent row exists.
--   * Strand C: activity_invites.created_at > 24h ago AND accepted_at is
--     null AND reengagement_sent_at is null AND no auth.users row exists
--     for the invited email.
--
-- The intent row provides the activity context for strands A/B (the email
-- submitted for that list is the "target"). If the user genuinely created
-- or joined another list in the meantime, we still send — they explicitly
-- said they wanted this list.
-- ---------------------------------------------------------------------------
create or replace function public.internal_reengagement_candidates()
returns table (
  strand text,
  recipient_email text,
  user_id uuid,
  display_name text,
  activity_id uuid,
  activity_name text,
  activity_emoji text,
  inviter_name text,
  share_token text,
  invite_token text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  -- Strand A: intent exists, auth.users row exists, email_confirmed_at is null.
  select
    'A'::text as strand,
    u.email::text as recipient_email,
    u.id as user_id,
    coalesce(p.display_name, (u.raw_user_meta_data ->> 'full_name'), '') as display_name,
    a.id as activity_id,
    a.name as activity_name,
    coalesce(a.emoji, '') as activity_emoji,
    coalesce(pi.display_name, (ownr.raw_user_meta_data ->> 'full_name'), '') as inviter_name,
    si.token as share_token,
    ''::text as invite_token
  from public.share_link_signup_intents si
  join public.activities a on a.id = si.activity_id
  join auth.users u on lower(u.email) = lower(si.email)
  left join public.profiles p on p.id = u.id
  join auth.users ownr on ownr.id = a.owner_id
  left join public.profiles pi on pi.id = a.owner_id
  where u.email_confirmed_at is null
    and si.created_at < now() - interval '24 hours'
    and not exists (
      select 1 from public.reengagement_sent rs
      where rs.user_id = u.id and rs.activity_id = a.id and rs.strand = 'A'
    )

  union all

  -- Strand B: intent exists, user signed in, but isn't a member of the
  -- target activity. The robustness fix should catch most of these at
  -- sign-in time; this covers the residual (token expired, edge-function
  -- glitch, intent row written after sign-in).
  select
    'B'::text as strand,
    u.email::text as recipient_email,
    u.id as user_id,
    coalesce(p.display_name, (u.raw_user_meta_data ->> 'full_name'), '') as display_name,
    a.id as activity_id,
    a.name as activity_name,
    coalesce(a.emoji, '') as activity_emoji,
    coalesce(pi.display_name, (ownr.raw_user_meta_data ->> 'full_name'), '') as inviter_name,
    si.token as share_token,
    ''::text as invite_token
  from public.share_link_signup_intents si
  join public.activities a on a.id = si.activity_id
  join auth.users u on lower(u.email) = lower(si.email)
  left join public.profiles p on p.id = u.id
  join auth.users ownr on ownr.id = a.owner_id
  left join public.profiles pi on pi.id = a.owner_id
  where u.email_confirmed_at is not null
    and si.created_at < now() - interval '24 hours'
    and not exists (
      select 1 from public.activity_members m
      where m.user_id = u.id and m.activity_id = a.id
    )
    and not exists (
      select 1 from public.reengagement_sent rs
      where rs.user_id = u.id and rs.activity_id = a.id and rs.strand = 'B'
    )

  union all

  -- Strand C: activity_invites with no matching auth.users row.
  select
    'C'::text as strand,
    inv.email::text as recipient_email,
    null::uuid as user_id,
    ''::text as display_name,
    a.id as activity_id,
    a.name as activity_name,
    coalesce(a.emoji, '') as activity_emoji,
    coalesce(pi.display_name, (ownr.raw_user_meta_data ->> 'full_name'), '') as inviter_name,
    ''::text as share_token,
    inv.token as invite_token
  from public.activity_invites inv
  join public.activities a on a.id = inv.activity_id
  join auth.users ownr on ownr.id = a.owner_id
  left join public.profiles pi on pi.id = a.owner_id
  where inv.accepted_at is null
    and inv.reengagement_sent_at is null
    and inv.created_at < now() - interval '24 hours'
    and not exists (
      select 1 from auth.users u where lower(u.email) = lower(inv.email)
    );
$$;

revoke all on function public.internal_reengagement_candidates() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- internal_mark_reengagement_sent(strand, user_id, activity_id, invite_token)
--
-- Records a successful send. For strands A/B writes to reengagement_sent;
-- for strand C stamps activity_invites.reengagement_sent_at. Separate path
-- because strand C has no user_id.
-- ---------------------------------------------------------------------------
create or replace function public.internal_mark_reengagement_sent(
  p_strand text,
  p_user_id uuid,
  p_activity_id uuid,
  p_invite_token text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_strand in ('A', 'B') then
    insert into public.reengagement_sent (user_id, activity_id, strand, sent_at)
    values (p_user_id, p_activity_id, p_strand, now())
    on conflict (user_id, activity_id, strand) do update
      set sent_at = excluded.sent_at;
  elsif p_strand = 'C' then
    update public.activity_invites
      set reengagement_sent_at = now()
      where token = p_invite_token;
  end if;
end $$;

revoke all on function public.internal_mark_reengagement_sent(text, uuid, uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- record_share_intent(email, activity_id, token) — server-side writer.
--
-- Called by the record-share-intent edge function, which validates the
-- (token, activity_id) pair matches a real share link before calling this.
-- Upsert by email: most recent submit wins, older intent (if any) drops.
-- ---------------------------------------------------------------------------
create or replace function public.internal_record_share_intent(
  p_email text,
  p_activity_id uuid,
  p_token text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.share_link_signup_intents (email, activity_id, token)
  values (lower(p_email), p_activity_id, p_token)
  on conflict (email) do update
    set activity_id = excluded.activity_id,
        token = excluded.token,
        updated_at = now();
end $$;

revoke all on function public.internal_record_share_intent(text, uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- lookup_share_intent(email) — used by app.js after sign-in to decide
-- whether to auto-join a brand-new user. Returns at most one row.
--
-- Exposed to authenticated users so the client can read it without a
-- service-role round-trip. Users can only look up their OWN email.
-- ---------------------------------------------------------------------------
create or replace function public.lookup_my_share_intent()
returns table (
  activity_id uuid,
  token text,
  created_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select si.activity_id, si.token, si.created_at
  from public.share_link_signup_intents si
  join auth.users u on lower(u.email) = si.email
  where u.id = auth.uid()
  limit 1;
$$;

grant execute on function public.lookup_my_share_intent() to authenticated;

-- ---------------------------------------------------------------------------
-- clear_my_share_intent() — called by app.js after a successful auto-join
-- so we don't repeatedly try to apply the same intent on every future sign-in.
-- ---------------------------------------------------------------------------
create or replace function public.clear_my_share_intent()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.share_link_signup_intents si
  using auth.users u
  where u.id = auth.uid() and lower(u.email) = si.email;
end $$;

grant execute on function public.clear_my_share_intent() to authenticated;
