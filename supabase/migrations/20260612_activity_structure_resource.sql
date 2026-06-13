-- Document extended band_activity action types (column is plain text; no schema change required).
-- New actions: 'structure' | 'resource'
--
-- structure — user finished editing song structure (sections)
-- resource  — user added a note, file, link, or lyrics resource
--
-- Run in Supabase SQL editor if band_activity already exists from 20260611_band_activity.sql.
-- Safe to run multiple times.

comment on column band_activity.action is
  'merge | branch | comment | upload | export | structure | resource | resource_update | resource_remove | meta';
