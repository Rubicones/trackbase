-- Attach optional branch / track context to project resources (files & links).

alter table project_resources
  add column if not exists context_version_id uuid references versions(id) on delete set null,
  add column if not exists context_track_id uuid references tracks(id) on delete set null;

create index if not exists project_resources_context_version_idx
  on project_resources (context_version_id)
  where context_version_id is not null;

create index if not exists project_resources_context_track_idx
  on project_resources (context_track_id)
  where context_track_id is not null;
