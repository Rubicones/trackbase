-- Fix permissive / duplicate RLS policies identified in security audit.
-- Safe to re-run: every CREATE is preceded by DROP IF EXISTS.
-- Run in Supabase Dashboard → SQL Editor.

-- ─── project_resources: drop wide-open duplicate policies ─────────────────────
DROP POLICY IF EXISTS "project_resources_insert" ON public.project_resources;
DROP POLICY IF EXISTS "project_resources_update" ON public.project_resources;
DROP POLICY IF EXISTS "project_resources_delete" ON public.project_resources;
DROP POLICY IF EXISTS "project_resources_select" ON public.project_resources;

DROP POLICY IF EXISTS "resources_select" ON public.project_resources;
CREATE POLICY "resources_select" ON public.project_resources
  FOR SELECT USING (
    project_id IN (
      SELECT p.id FROM public.projects p
      JOIN public.band_members bm ON bm.band_id = p.band_id
      WHERE bm.user_id = auth.uid()
    )
  );

-- ─── project_roadmap_steps: drop open write policies, add band-scoped ALL ─────
DROP POLICY IF EXISTS "project_roadmap_steps_insert" ON public.project_roadmap_steps;
DROP POLICY IF EXISTS "project_roadmap_steps_update" ON public.project_roadmap_steps;
DROP POLICY IF EXISTS "project_roadmap_steps_delete" ON public.project_roadmap_steps;
DROP POLICY IF EXISTS "project_roadmap_steps_write" ON public.project_roadmap_steps;
CREATE POLICY "project_roadmap_steps_write" ON public.project_roadmap_steps
  FOR ALL USING (
    project_id IN (
      SELECT p.id FROM public.projects p
      JOIN public.band_members bm ON bm.band_id = p.band_id
      WHERE bm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    project_id IN (
      SELECT p.id FROM public.projects p
      JOIN public.band_members bm ON bm.band_id = p.band_id
      WHERE bm.user_id = auth.uid()
    )
  );

-- ─── band_invites: remove world-readable token lookup ─────────────────────────
DROP POLICY IF EXISTS "invites_select_by_token" ON public.band_invites;
DROP POLICY IF EXISTS "invites_select_members" ON public.band_invites;
CREATE POLICY "invites_select_members" ON public.band_invites
  FOR SELECT USING (
    band_id IN (
      SELECT band_id FROM public.band_members WHERE user_id = auth.uid()
    )
  );

-- ─── sections: band-scoped SELECT (replace using true) ────────────────────────
DROP POLICY IF EXISTS "sections_select" ON public.sections;
CREATE POLICY "sections_select" ON public.sections
  FOR SELECT USING (
    version_id IN (
      SELECT v.id FROM public.versions v
      JOIN public.projects p ON p.id = v.project_id
      JOIN public.band_members bm ON bm.band_id = p.band_id
      WHERE bm.user_id = auth.uid()
    )
  );

-- ─── comment_replies: band-scoped SELECT (replace using true) ───────────────
DROP POLICY IF EXISTS "replies_select" ON public.comment_replies;
CREATE POLICY "replies_select" ON public.comment_replies
  FOR SELECT USING (
    comment_id IN (
      SELECT tc.id FROM public.track_comments tc
      JOIN public.versions v ON v.id = tc.version_id
      JOIN public.projects p ON p.id = v.project_id
      JOIN public.band_members bm ON bm.band_id = p.band_id
      WHERE bm.user_id = auth.uid()
    )
  );

-- ─── band_activity: require band membership on insert ───────────────────────
DROP POLICY IF EXISTS "activity_insert" ON public.band_activity;
CREATE POLICY "activity_insert" ON public.band_activity
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND band_id IN (
      SELECT band_id FROM public.band_members WHERE user_id = auth.uid()
    )
  );

-- ─── band_members: remove duplicate SELECT policy ───────────────────────────
DROP POLICY IF EXISTS "members_select" ON public.band_members;
