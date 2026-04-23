-- Generic suggestion chips for the packing list view.
--
-- Activity-specific generic items (hat, trekking poles, sunscreen, …) seeded
-- once per activity by the generate-suggestions Edge Function (Claude) and
-- consumed by the client as users tap chips. Universals (first aid, bug
-- spray, etc.) live client-side in app.js so they always reappear — only the
-- activity-specific pool lives here.
--
-- Lifecycle:
--   * Insert: generate-suggestions Edge Function (service role) after Claude
--     returns a batch.
--   * Select: members of the activity.
--   * Delete: on chip tap, client-side (by members). No update path.
--
-- Rows are activity-scoped, not user-scoped: once one member taps a chip,
-- it's consumed for the whole list (co-members see the row disappear on
-- next refetch). Same mental model as activity_items.

create table if not exists public.generic_suggestions (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  name text not null,
  emoji text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists generic_suggestions_activity_pos_idx
  on public.generic_suggestions (activity_id, position);

alter table public.generic_suggestions enable row level security;

-- Member-scoped policies mirror activity_items (see 20260422000000_shared_activities.sql).
drop policy if exists "generic_suggestions_select_member" on public.generic_suggestions;
create policy "generic_suggestions_select_member" on public.generic_suggestions
  for select to authenticated using (public.is_activity_member(activity_id));

drop policy if exists "generic_suggestions_insert_member" on public.generic_suggestions;
create policy "generic_suggestions_insert_member" on public.generic_suggestions
  for insert to authenticated with check (public.is_activity_member(activity_id));

drop policy if exists "generic_suggestions_delete_member" on public.generic_suggestions;
create policy "generic_suggestions_delete_member" on public.generic_suggestions
  for delete to authenticated using (public.is_activity_member(activity_id));

-- Admin read (mirrors 20260422120000_admin_function.sql pattern).
drop policy if exists "generic_suggestions_admin_select" on public.generic_suggestions;
create policy "generic_suggestions_admin_select" on public.generic_suggestions
  for select to authenticated using (public.is_admin());
