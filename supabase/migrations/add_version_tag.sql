-- Migration: add tag column to versions
-- Run in Supabase SQL Editor
--
-- Allowed values: 'experiment' | 'fix' | 'arrangement' | 'mix' | 'feature'
-- or any free-text string up to 20 chars (custom tags)
-- null = no tag set

alter table versions
  add column if not exists tag text
  constraint versions_tag_length check (tag is null or char_length(tag) <= 20);
