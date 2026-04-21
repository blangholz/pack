-- Default owner_id to the authenticated user so clients don't have to pass it.
-- Without this, inserts that omit owner_id leave it NULL, which fails the
-- `auth.uid() = owner_id` RLS check with a 403.
alter table public.gear       alter column owner_id set default auth.uid();
alter table public.activities alter column owner_id set default auth.uid();
