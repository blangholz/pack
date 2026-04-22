-- Inviter nudge (re-engagement strand D).
--
-- Inverse of strand C: host explicitly invited someone via "Invite by email"
-- 3 days ago, invitee never accepted. We nudge the HOST (not the invitee)
-- with a one-button "remind them" email that re-sends the original invite.
--
-- Pairs with:
--   * supabase/functions/reengagement-emails — now emits strand D rows too.
--   * supabase/functions/share-activity — extended to accept
--     resend_invite_token as an alternative to email, driving the remind CTA.

-- ---------------------------------------------------------------------------
-- Dedupe column. Separate from the existing reengagement_sent_at (strand C)
-- because strand D fires on the SAME invite row but targets a different
-- recipient (host vs invitee). An invite can have both timestamps set — one
-- for each strand — and they're independent.
-- ---------------------------------------------------------------------------
alter table public.activity_invites
  add column if not exists inviter_nudge_sent_at timestamptz;

-- ---------------------------------------------------------------------------
-- Extend internal_reengagement_candidates() to emit strand D rows. The
-- uniform row shape gains one column (invitee_email) to carry the "who still
-- hasn't joined" identity for strand D's copy. Existing strands leave it
-- empty.
--
-- RETURNS TABLE shape change requires DROP + CREATE; signature-change
-- CREATE OR REPLACE is rejected by Postgres.
-- ---------------------------------------------------------------------------
drop function if exists public.internal_reengagement_candidates();

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
  invite_token text,
  invitee_email text
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
    ''::text as invite_token,
    ''::text as invitee_email
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

  -- Strand B: intent exists, user signed in, but isn't a member.
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
    ''::text as invite_token,
    ''::text as invitee_email
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
    inv.token as invite_token,
    ''::text as invitee_email
  from public.activity_invites inv
  join public.activities a on a.id = inv.activity_id
  join auth.users ownr on ownr.id = a.owner_id
  left join public.profiles pi on pi.id = a.owner_id
  where inv.accepted_at is null
    and inv.reengagement_sent_at is null
    and inv.created_at < now() - interval '24 hours'
    and not exists (
      select 1 from auth.users u where lower(u.email) = lower(inv.email)
    )

  union all

  -- Strand D: inviter nudge. Host invited someone 3+ days ago, invitee still
  -- hasn't accepted (regardless of whether they have an auth.users row —
  -- they might have registered but never joined this specific list).
  select
    'D'::text as strand,
    ownr.email::text as recipient_email,
    ownr.id as user_id,
    coalesce(po.display_name, (ownr.raw_user_meta_data ->> 'full_name'), '') as display_name,
    a.id as activity_id,
    a.name as activity_name,
    coalesce(a.emoji, '') as activity_emoji,
    ''::text as inviter_name,
    ''::text as share_token,
    inv.token as invite_token,
    inv.email::text as invitee_email
  from public.activity_invites inv
  join public.activities a on a.id = inv.activity_id
  join auth.users ownr on ownr.id = a.owner_id
  left join public.profiles po on po.id = a.owner_id
  where inv.accepted_at is null
    and inv.inviter_nudge_sent_at is null
    and inv.created_at < now() - interval '3 days';
$$;

revoke all on function public.internal_reengagement_candidates() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Extend internal_mark_reengagement_sent to route strand D to the new
-- inviter_nudge_sent_at column. Same (invite_token) scope as strand C, but
-- a different column so the two strands are tracked independently.
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
  elsif p_strand = 'D' then
    update public.activity_invites
      set inviter_nudge_sent_at = now()
      where token = p_invite_token;
  end if;
end $$;

-- The function signature didn't change, so the grants from the previous
-- migration carry over. Re-assert the lockdown anyway so an audit of this
-- file alone reflects the full permission posture.
revoke all on function public.internal_mark_reengagement_sent(text, uuid, uuid, text)
  from public, anon, authenticated;
