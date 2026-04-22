-- Share-by-link: one permanent token per activity.
--
-- Complements activity_invites (email-scoped, N-per-activity) with a single
-- shareable URL per activity. Anyone with the link can tap it, see a preview
-- via the share-link-preview Edge Function, sign up / sign in, and be auto-
-- enrolled via accept-share-link.
--
-- One row per activity (PK = activity_id) so the share modal always has a
-- ready link — the trigger below auto-creates the row on activity insert.

create table public.activity_share_links (
  activity_id uuid primary key references public.activities(id) on delete cascade,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'base64'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index activity_share_links_token_idx on public.activity_share_links (token);

alter table public.activity_share_links enable row level security;

-- SELECT: any member can read the link (so the share modal can display it).
create policy "activity_share_links_select_member" on public.activity_share_links
  for select to authenticated using (public.is_activity_member(activity_id));

-- INSERT: activity owner only. The trigger below runs as SECURITY DEFINER so
-- this policy is practically never exercised from the client.
create policy "activity_share_links_insert_owner" on public.activity_share_links
  for insert to authenticated with check (
    exists (
      select 1 from public.activities a
      where a.id = activity_share_links.activity_id and a.owner_id = auth.uid()
    )
  );

-- UPDATE/DELETE: owner only (future-proof, even though v1 has no regenerate
-- button — if we ever add one, the policy is already correct).
create policy "activity_share_links_update_owner" on public.activity_share_links
  for update to authenticated using (
    exists (
      select 1 from public.activities a
      where a.id = activity_share_links.activity_id and a.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.activities a
      where a.id = activity_share_links.activity_id and a.owner_id = auth.uid()
    )
  );

create policy "activity_share_links_delete_owner" on public.activity_share_links
  for delete to authenticated using (
    exists (
      select 1 from public.activities a
      where a.id = activity_share_links.activity_id and a.owner_id = auth.uid()
    )
  );

-- Auto-create a share link when an activity is inserted. Same trigger pattern
-- as handle_new_activity; runs SECURITY DEFINER so it bypasses the INSERT
-- policy (the new row has owner_id = auth.uid() at that moment anyway).
create or replace function public.handle_new_activity_share_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.activity_share_links (activity_id, created_by)
  values (new.id, new.owner_id)
  on conflict (activity_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_activity_created_share_link on public.activities;
create trigger on_activity_created_share_link
  after insert on public.activities
  for each row execute function public.handle_new_activity_share_link();

-- Backfill: create a share link for every existing activity. Idempotent.
insert into public.activity_share_links (activity_id, created_by)
select id, owner_id from public.activities
on conflict (activity_id) do nothing;
