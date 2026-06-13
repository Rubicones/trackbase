-- Project resources (files, links, lyrics, notes) + project bpm/key metadata.
-- Safe to run multiple times (IF NOT EXISTS / IF NOT EXISTS columns).

alter table public.projects
  add column if not exists bpm integer,
  add column if not exists key text;

create table if not exists public.project_resources (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  type                text not null,  -- 'file' | 'link' | 'lyrics' | 'notes'
  storage_path        text,
  original_filename   text,
  file_size_bytes     bigint,
  mime_type           text,
  url                 text,
  title               text,
  content             text,
  created_by          uuid references auth.users(id) on delete set null,
  position            integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists project_resources_project_id_position
  on public.project_resources(project_id, position, created_at);

alter table public.project_resources enable row level security;

create policy "project_resources_select" on public.project_resources
  for select using (
    project_id in (
      select p.id from public.projects p
      join public.band_members bm on bm.band_id = p.band_id
      where bm.user_id = auth.uid()
    )
  );

-- Inserts/updates/deletes go through service-key API routes.
create policy "project_resources_insert" on public.project_resources
  for insert with check (true);

create policy "project_resources_update" on public.project_resources
  for update using (true);

create policy "project_resources_delete" on public.project_resources
  for delete using (true);
