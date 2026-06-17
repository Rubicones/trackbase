-- Custom per-project roadmap steps + current step index.
-- Safe to run multiple times.

alter table public.projects
  add column if not exists roadmap_step_index integer,
  add column if not exists stage_since timestamptz;

create table if not exists public.project_roadmap_steps (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint project_roadmap_steps_name_len check (char_length(name) between 1 and 50)
);

create index if not exists project_roadmap_steps_project_id_position
  on public.project_roadmap_steps(project_id, position);

alter table public.project_roadmap_steps enable row level security;

create policy "project_roadmap_steps_select" on public.project_roadmap_steps
  for select using (
    project_id in (
      select p.id from public.projects p
      join public.band_members bm on bm.band_id = p.band_id
      where bm.user_id = auth.uid()
    )
  );

-- Inserts/updates/deletes go through service-key API routes.
create policy "project_roadmap_steps_insert" on public.project_roadmap_steps
  for insert with check (true);

create policy "project_roadmap_steps_update" on public.project_roadmap_steps
  for update using (true);

create policy "project_roadmap_steps_delete" on public.project_roadmap_steps
  for delete using (true);
