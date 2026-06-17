-- Preview mix cache columns on projects
-- preview_mix_status: 'none' | 'fresh' | 'stale' | 'computing'
-- main_version_modified_at: updated whenever something that affects the rendered
--   audio of main changes (track added/removed/replaced, start_bar change, bpm/
--   time_signature change, branch merged into main).

alter table projects
  add column if not exists preview_mix_storage_path text,
  add column if not exists preview_mix_status text not null default 'none',
  add column if not exists preview_mix_generated_at timestamptz,
  add column if not exists preview_mix_computing_started_at timestamptz,
  add column if not exists main_version_modified_at timestamptz default now();
