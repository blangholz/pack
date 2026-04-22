-- Closes the remaining cross-user sync gaps:
--
--   * gear: when user A renames/edits a piece of gear, user B (who has it
--     in a shared activity's packing list) was seeing the stale name until
--     refresh. gear wasn't in the realtime publication at all.
--   * activities: INSERTs (new shared activity) and DELETEs (removed
--     activity) need the full old/new row so the client can route by id.
--     The table is already in the publication; this just upgrades replica
--     identity so DELETE events carry more than just the PK.
--
-- See SPEC.md 11.10 for why REPLICA IDENTITY FULL is needed.

-- 1. Add gear to the realtime publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gear'
  ) then
    execute 'alter publication supabase_realtime add table public.gear';
  end if;
end $$;

-- 2. Replica identity full so DELETE events ship the whole old row (so
--    routing-by-column works in client handlers). gear and activities are
--    the remaining tables we subscribe to that hadn't been upgraded yet.
alter table public.gear       replica identity full;
alter table public.activities replica identity full;
