-- Drop the unused `notes` table. Earlier migrations left it world-readable
-- and world-writable by the anon role, which is a spam/abuse vector now that
-- the project is being shared. The app uses `gear.notes` (a column), not this
-- table, so it's safe to remove outright.
drop table if exists public.notes;
