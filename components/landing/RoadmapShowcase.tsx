"use client";

import { SongRoadmap } from "@/components/SongRoadmap";
import type { ProjectRoadmap } from "@/lib/roadmap";

/* ============================================================
 * Roadmap showcase — /simple, 02.3 SOCIAL
 * ============================================================
 *
 * The real `SongRoadmap` from the app, filled with placeholder data, rendered
 * read-only. Not a mock of it — the same component the project page mounts, so
 * the landing page cannot drift from the product it is advertising.
 *
 * Non-interactive by construction, not by an overlay:
 *   * `readOnly` disables every step button and the "Edit steps" control, and
 *     hides the back/Advance pair from the header;
 *   * `onRoadmapChange` is omitted, so `jump()`, `jumpTo()` and `moveTo()` all
 *     return before touching `/api/projects/[id]/roadmap`. Nothing here can
 *     fire a request or a `roadmap_step_changed` event.
 * Both matter: `readOnly` alone still leaves the write paths defined.
 */

/** Placeholder only — never fetched with, see the note above. */
const PLACEHOLDER_PROJECT_ID = "landing-preview";

const PLACEHOLDER_ROADMAP: ProjectRoadmap = {
  configured: true,
  // Two stages done, "Recording" current — the same "stage 2 of 5" read the
  // hand-rolled mock had, with enough steps that the connectors are visible.
  stepIndex: 2,
  // Null on purpose: a real timestamp would make the footer render a relative
  // "since …" that drifts, and would start SongRoadmap's 60-second re-render
  // interval on a static marketing page.
  stageSince: null,
  steps: [
    { id: "demo", name: "Demo", position: 0 },
    { id: "arrangement", name: "Arrangement", position: 1 },
    { id: "recording", name: "Recording", position: 2 },
    { id: "mixing", name: "Mixing", position: 3 },
    { id: "master", name: "Master", position: 4 },
  ],
};

export function RoadmapShowcase() {
  return (
    <SongRoadmap projectId={PLACEHOLDER_PROJECT_ID} roadmap={PLACEHOLDER_ROADMAP} readOnly />
  );
}
