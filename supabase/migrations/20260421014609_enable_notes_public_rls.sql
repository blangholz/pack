alter table public.notes enable row level security;

create policy "anon_select_notes"
  on public.notes for select
  to anon
  using (true);

create policy "anon_insert_notes"
  on public.notes for insert
  to anon
  with check (true);
