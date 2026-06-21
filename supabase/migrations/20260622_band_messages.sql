-- Band chat — realtime messages per band / per project channel.
create table if not exists band_messages (
  id uuid primary key default gen_random_uuid(),
  band_id uuid references bands(id) on delete cascade,
  channel_id uuid references projects(id) on delete cascade,
  -- null channel_id = band-wide "# BAND" channel
  user_id uuid references auth.users(id),
  content text not null,

  -- optional context chips attached to message
  context_version_id uuid references versions(id) on delete set null,
  context_track_id uuid references tracks(id) on delete set null,
  context_timecode_start_ms integer,
  context_timecode_end_ms integer,

  -- for auto-generated messages from track comments
  type text default 'message', -- 'message' | 'track_comment'
  source_track_comment_id uuid references track_comments(id)
    on delete cascade,

  created_at timestamptz default now()
);

create index if not exists band_messages_band_channel_created
  on band_messages(band_id, channel_id, created_at);
create index if not exists band_messages_source_track_comment
  on band_messages(source_track_comment_id);

alter table band_messages enable row level security;

create policy "messages_select" on band_messages
  for select using (
    band_id in (
      select band_id from band_members where user_id = auth.uid()
    )
  );

create policy "messages_insert" on band_messages
  for insert with check (
    auth.uid() = user_id and
    band_id in (
      select band_id from band_members where user_id = auth.uid()
    )
  );

create policy "messages_delete" on band_messages
  for delete using (
    auth.uid() = user_id or
    band_id in (
      select band_id from band_members
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- Stream INSERTs to the browser client via Supabase Realtime.
-- RLS above governs which rows each subscriber actually receives.
alter publication supabase_realtime add table band_messages;
