-- ─── 20260611_midi_columns.sql ────────────────────────────────────────────────
-- Adds MIDI support columns to the tracks table.
-- Run via Supabase dashboard → SQL editor, or `supabase db push`.

-- file_type distinguishes audio (wav/mp3/flac) from MIDI tracks.
-- Defaults to 'audio' so existing rows are unaffected.
alter table public.tracks
  add column if not exists file_type text not null default 'audio'
    check (file_type in ('audio', 'midi'));

-- midi_data caches the parsed MidiTrackData JSON for MIDI tracks.
-- NULL for audio tracks; populated on first upload or first GET /api/tracks/[id]/midi.
alter table public.tracks
  add column if not exists midi_data jsonb;

-- Index for quickly finding MIDI tracks within a version.
create index if not exists tracks_file_type_idx on public.tracks (file_type);
