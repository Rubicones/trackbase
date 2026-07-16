-- Feature tours store completion flags in profiles.onboarding (jsonb).
-- Keys written by the app (no pre-seed required; unset = pending):
--   compare_tour_completed / compare_tour_skipped
--   structure_tour_completed / structure_tour_skipped
--   cherrypick_tour_completed / cherrypick_tour_skipped
--   track_edit_tour_completed / track_edit_tour_skipped
-- Plus existing: dashboard_seen, band_seen, project_tour_*, mobile_project_tour_*

alter table public.profiles
  add column if not exists onboarding jsonb not null default '{}'::jsonb;

update public.profiles
set onboarding = '{}'::jsonb
where onboarding is null;
