-- Per-user fixed-window rate limiter. Used by the extract-gear edge
-- function to cap how often a single signed-in user can invoke Anthropic.

create table public.rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (user_id, bucket, window_start)
);

create index rate_limits_window_idx on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;
-- No client-facing policies: all access goes through hit_rate_limit().

-- Atomically increment a user's counter for the current fixed window and
-- return whether the caller is still within `max_count` hits per
-- `window_seconds`. Runs as definer so clients don't need direct table
-- access; auth.uid() is read from the caller's JWT.
create or replace function public.hit_rate_limit(
  bucket text,
  max_count integer,
  window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  w timestamptz;
  new_count integer;
begin
  if uid is null then
    return false;
  end if;
  w := to_timestamp(
    floor(extract(epoch from now()) / greatest(window_seconds, 1)) * greatest(window_seconds, 1)
  );
  insert into public.rate_limits as r (user_id, bucket, window_start, count)
    values (uid, bucket, w, 1)
    on conflict (user_id, bucket, window_start)
    do update set count = r.count + 1
    returning r.count into new_count;

  -- Opportunistic cleanup of expired rows (~1% of calls).
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 hour';
  end if;

  return new_count <= max_count;
end;
$$;

revoke all on function public.hit_rate_limit(text, integer, integer) from public;
grant execute on function public.hit_rate_limit(text, integer, integer) to authenticated;
