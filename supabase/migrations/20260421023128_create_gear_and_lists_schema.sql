-- Multi-user gear + packing list schema.
-- Every row is scoped to an owner (auth.users). RLS enforces that users
-- only read/write their own data. A profile row is auto-created on signup.

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user, holds per-user settings
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  display_unit text not null default 'g' check (display_unit in ('g','kg','oz','lb')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select to authenticated using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "profiles_delete_own" on public.profiles
  for delete to authenticated using (auth.uid() = id);

-- Auto-create a profile row on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- gear: a user's gear library
-- ---------------------------------------------------------------------------
create table public.gear (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  brand text,
  weight_grams numeric,
  url text,
  image_url text,
  notes text,
  color text,
  available_colors text[] not null default '{}',
  quantity integer not null default 1 check (quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gear_owner_created_idx on public.gear (owner_id, created_at desc);

create trigger gear_touch_updated_at
  before update on public.gear
  for each row execute function public.touch_updated_at();

alter table public.gear enable row level security;

create policy "gear_select_own" on public.gear
  for select to authenticated using (auth.uid() = owner_id);

create policy "gear_insert_own" on public.gear
  for insert to authenticated with check (auth.uid() = owner_id);

create policy "gear_update_own" on public.gear
  for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "gear_delete_own" on public.gear
  for delete to authenticated using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- activities: named packing lists (Climbing, Highlining, ...)
-- ---------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  emoji text,
  position integer not null default 0,
  active_weathers text[] not null default '{}',
  active_custom_filter_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index activities_owner_position_idx on public.activities (owner_id, position);

create trigger activities_touch_updated_at
  before update on public.activities
  for each row execute function public.touch_updated_at();

alter table public.activities enable row level security;

create policy "activities_select_own" on public.activities
  for select to authenticated using (auth.uid() = owner_id);

create policy "activities_insert_own" on public.activities
  for insert to authenticated with check (auth.uid() = owner_id);

create policy "activities_update_own" on public.activities
  for update to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy "activities_delete_own" on public.activities
  for delete to authenticated using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- custom_filters: user-defined tags on items within an activity
-- ---------------------------------------------------------------------------
create table public.custom_filters (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  label text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index custom_filters_activity_idx on public.custom_filters (activity_id, position);

alter table public.custom_filters enable row level security;

create policy "custom_filters_select_own" on public.custom_filters
  for select to authenticated using (
    exists (
      select 1 from public.activities a
      where a.id = custom_filters.activity_id and a.owner_id = auth.uid()
    )
  );

create policy "custom_filters_insert_own" on public.custom_filters
  for insert to authenticated with check (
    exists (
      select 1 from public.activities a
      where a.id = custom_filters.activity_id and a.owner_id = auth.uid()
    )
  );

create policy "custom_filters_update_own" on public.custom_filters
  for update to authenticated using (
    exists (
      select 1 from public.activities a
      where a.id = custom_filters.activity_id and a.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.activities a
      where a.id = custom_filters.activity_id and a.owner_id = auth.uid()
    )
  );

create policy "custom_filters_delete_own" on public.custom_filters
  for delete to authenticated using (
    exists (
      select 1 from public.activities a
      where a.id = custom_filters.activity_id and a.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- activity_items: a gear reference inside an activity
-- ---------------------------------------------------------------------------
create table public.activity_items (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  gear_id uuid not null references public.gear(id) on delete cascade,
  position integer not null default 0,
  packed boolean not null default false,
  quantity integer not null default 1 check (quantity >= 0),
  note text,
  weather_tags text[] not null default '{}',
  custom_filter_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (activity_id, gear_id)
);

create index activity_items_activity_position_idx on public.activity_items (activity_id, position);
create index activity_items_gear_idx on public.activity_items (gear_id);

create trigger activity_items_touch_updated_at
  before update on public.activity_items
  for each row execute function public.touch_updated_at();

alter table public.activity_items enable row level security;

create policy "activity_items_select_own" on public.activity_items
  for select to authenticated using (
    exists (
      select 1 from public.activities a
      where a.id = activity_items.activity_id and a.owner_id = auth.uid()
    )
  );

create policy "activity_items_insert_own" on public.activity_items
  for insert to authenticated with check (
    exists (
      select 1 from public.activities a
      where a.id = activity_items.activity_id and a.owner_id = auth.uid()
    )
    and exists (
      select 1 from public.gear g
      where g.id = activity_items.gear_id and g.owner_id = auth.uid()
    )
  );

create policy "activity_items_update_own" on public.activity_items
  for update to authenticated using (
    exists (
      select 1 from public.activities a
      where a.id = activity_items.activity_id and a.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.activities a
      where a.id = activity_items.activity_id and a.owner_id = auth.uid()
    )
  );

create policy "activity_items_delete_own" on public.activity_items
  for delete to authenticated using (
    exists (
      select 1 from public.activities a
      where a.id = activity_items.activity_id and a.owner_id = auth.uid()
    )
  );
