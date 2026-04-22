-- Fix: INSERT ... RETURNING on activities was failing with 42501 "new row
-- violates row-level security policy" for the creator, even though the
-- creator clearly passes the INSERT WITH CHECK (auth.uid() = owner_id).
--
-- Cause: PostgREST sends INSERT with RETURNING when the client calls
-- `.insert().select().single()`. Postgres then evaluates the SELECT policy
-- against the returned row. Our SELECT policy was `is_activity_member(id)`
-- -- a STABLE, SECURITY DEFINER function that queries activity_members.
-- The AFTER INSERT trigger (handle_new_activity) does insert the creator's
-- member row, but within the same INSERT statement the STABLE function's
-- snapshot doesn't reflect the trigger's write, so it returns false and the
-- RETURNING clause errors with the (misleading) RLS message.
--
-- The owner is always a member (the trigger guarantees it), so adding an
-- `owner_id = auth.uid()` short-circuit to the SELECT and UPDATE policies
-- is semantics-preserving and sidesteps the snapshot edge case entirely.
-- It also makes the common "own row" path a single indexed column check
-- instead of a function call.

drop policy if exists "activities_select_member" on public.activities;
create policy "activities_select_member" on public.activities
  for select to authenticated using (
    owner_id = auth.uid() or public.is_activity_member(id)
  );

drop policy if exists "activities_update_member" on public.activities;
create policy "activities_update_member" on public.activities
  for update to authenticated
  using (owner_id = auth.uid() or public.is_activity_member(id))
  with check (owner_id = auth.uid() or public.is_activity_member(id));
