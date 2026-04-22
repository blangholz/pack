-- Realtime DELETE events ship only the primary key by default, because
-- Postgres logical replication uses REPLICA IDENTITY DEFAULT (= the PK).
-- That means `payload.old` on a DELETE arrives as `{ id }` — every other
-- column (activity_id, gear_id, owner_id, ...) is null. Two problems:
--
--   1. Per-activity realtime channels filter on `activity_id=eq.<uuid>`,
--      which never matches a DELETE event whose old row has no
--      activity_id. So co-members never see deletions.
--   2. Our global activity_items handler routes by activity_id too — same
--      problem.
--
-- Setting REPLICA IDENTITY FULL makes the WAL include every column of the
-- old row on UPDATE/DELETE, so realtime subscribers can route and apply
-- the change. Cost is a slightly larger WAL footprint, which is fine for
-- these small per-user tables.
--
-- Tables affected: every per-activity table where deletion needs to
-- propagate to other members in the same activity in real time.
alter table public.activity_items   replica identity full;
alter table public.activity_members replica identity full;
alter table public.custom_filters   replica identity full;
