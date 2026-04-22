-- One-off cleanup: delete duplicate activities created by the onSignedIn
-- seeding race (multiple concurrent onSignedIn calls each inserting the same
-- 4 default activities on first login).
--
-- Strategy: for each (owner_id, name, emoji) group, keep the earliest-created
-- row and delete the rest. Cascades via FK on activity_items /
-- activity_members / custom_filters / activity_invites clean up child rows.
--
-- Safe assumptions at the time of this cleanup:
--   * No user has intentionally created two activities with identical name AND
--     emoji. (The duplicates in the wild differ only by id/created_at.)
--   * Items/members were only ever attached to one of the dup rows because the
--     client only kept the first on the tab strip; so we're not losing
--     packed-state on the row we discard.

delete from public.activities a
using (
  select id,
         row_number() over (
           partition by owner_id, name, emoji
           order by created_at asc, id asc
         ) as rn
  from public.activities
) t
where a.id = t.id
  and t.rn > 1;
