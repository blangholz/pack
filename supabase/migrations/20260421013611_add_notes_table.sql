create table public.notes (
  id uuid primary key default gen_random_uuid(),
  body text not null,
  created_at timestamp default now()
);
