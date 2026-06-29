-- Convert track_comments from project-timeline ms to track-content-relative ms.
-- After this, start_bar changes do not require updating comment rows.

UPDATE track_comments tc
SET
  timecode_start_ms = tc.timecode_start_ms - offset_ms,
  timecode_end_ms = tc.timecode_end_ms - offset_ms
FROM (
  SELECT
    tc2.id,
    (
      COALESCE(tr.start_bar, tr.midi_start_bar, 0)
      * (60000.0 / COALESCE(p.bpm, 120))
      * COALESCE(NULLIF(split_part(COALESCE(p.time_signature, '4/4'), '/', 1), '')::int, 4)
    )::int AS offset_ms
  FROM track_comments tc2
  JOIN tracks tr ON tr.id = tc2.track_id
  JOIN versions v ON v.id = tr.version_id
  JOIN projects p ON p.id = v.project_id
) AS offsets
WHERE tc.id = offsets.id
  AND offsets.offset_ms <> 0;
