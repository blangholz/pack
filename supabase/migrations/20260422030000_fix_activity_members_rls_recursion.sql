-- Fix: infinite recursion in RLS policies that SELECT from activity_members
-- while *being* the policy on activity_members (or the profiles policy that
-- cross-joins activity_members twice).
--
-- The activity_members_select_self_or_comember policy had a subquery against
-- activity_members, which re-triggered the same SELECT policy → recursion.
-- The profiles_select_own_or_comember policy joined activity_members twice,
-- which also recursed.
--
-- Fix: route both through SECURITY DEFINER helpers that bypass RLS on
-- activity_members.

-- New helper: does the current user share any activity with the given user?
create or replace function public.shares_activity_with(other_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.activity_members mine
    join public.activity_members theirs on theirs.activity_id = mine.activity_id
    where mine.user_id = auth.uid()
      and theirs.user_id = other_id
  );
$$;

revoke all on function public.shares_activity_with(uuid) from public;
grant execute on function public.shares_activity_with(uuid) to authenticated;

-- Replace the recursive activity_members SELECT policy.
drop policy if exists "activity_members_select_self_or_comember" on public.activity_members;

create policy "activity_members_select_self_or_comember" on public.activity_members
  for select to authenticated using (
    user_id = auth.uid()
    or public.is_activity_member(activity_id)
  );

-- Replace the recursive profiles SELECT policy.
drop policy if exists "profiles_select_own_or_comember" on public.profiles;

create policy "profiles_select_own_or_comember" on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or public.shares_activity_with(id)
  );
