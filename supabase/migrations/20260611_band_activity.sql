-- Band activity feed
create table if not exists band_activity (
  id         uuid primary key default gen_random_uuid(),
  band_id    uuid references bands(id) on delete cascade,
  user_id    uuid references auth.users(id),
  action     text not null,
    -- 'merge' | 'branch' | 'comment' | 'upload' | 'export'
  subject    text not null,   -- human-readable object name
  detail     text,            -- extra context (timecode, file size, etc.)
  project_id uuid references projects(id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists band_activity_band_id_created_at
  on band_activity(band_id, created_at desc);

alter table band_activity enable row level security;

create policy "activity_select" on band_activity
  for select using (
    band_id in (
      select band_id from band_members
      where user_id = auth.uid()
    )
  );

-- Inserts go through the service-key client (bypasses RLS).
-- This permissive policy covers any client-side inserts if needed.
create policy "activity_insert" on band_activity
  for insert with check (true);
