-- Add start_bar column for all track types (replaces midi_start_bar for new code)
alter table tracks
  add column if not exists start_bar integer default 0;

-- Migrate existing midi_start_bar values to start_bar
update tracks
  set start_bar = midi_start_bar
  where midi_start_bar > 0
  and file_type = 'midi';
