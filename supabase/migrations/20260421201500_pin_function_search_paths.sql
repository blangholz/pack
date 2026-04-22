-- Pin search_path on public functions so a malicious schema can't shadow
-- built-ins during trigger execution. Flagged by Supabase security advisor.

alter function public.touch_updated_at() set search_path = public, pg_temp;
