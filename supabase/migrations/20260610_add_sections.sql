-- Add time signature to projects
alter table projects
  add column if not exists time_signature text default '4/4';

-- Sections table
create table sections (
  id uuid primary key default gen_random_uuid(),
  version_id uuid references versions(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  type text not null,
    -- 'intro' | 'verse' | 'chorus' | 'pre-chorus' |
    -- 'bridge' | 'drop' | 'breakdown' | 'outro' | 'custom'
  custom_name text,        -- only if type = 'custom'
  start_bar integer not null,
  end_bar integer not null,
  chords text,             -- space-separated: "Am F C G"
  color text not null,     -- hex color for this section
  position integer not null, -- order index
  created_at timestamptz default now()
);

create index on sections(version_id);
create index on sections(project_id);

alter table sections enable row level security;

create policy "sections_select" on sections
  for select using (true);

create policy "sections_insert" on sections
  for insert with check (
    version_id in (
      select v.id from versions v
      join projects p on p.id = v.project_id
      join band_members bm on bm.band_id = p.band_id
      where bm.user_id = auth.uid()
    )
  );

create policy "sections_update" on sections
  for update using (
    version_id in (
      select v.id from versions v
      join projects p on p.id = v.project_id
      join band_members bm on bm.band_id = p.band_id
      where bm.user_id = auth.uid()
    )
  );

create policy "sections_delete" on sections
  for delete using (
    version_id in (
      select v.id from versions v
      join projects p on p.id = v.project_id
      join band_members bm on bm.band_id = p.band_id
      where bm.user_id = auth.uid()
    )
  );
