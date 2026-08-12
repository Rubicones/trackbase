"use client";

import { useEffect, useState, type ComponentType } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  Users, Tag, Activity, BarChart3,
  GitBranch, GitMerge, History, GitCompare,
  AudioWaveform, Volume2, Mic, Timer, MessageSquare,
  LayoutGrid, Music2, Layers, ListMusic,
  Headphones, Play,
  Paperclip, Link2, FileText, Compass, CheckSquare, Pin,
  Smartphone, SlidersHorizontal, Maximize2,
  FileAudio, Share2, Eye, Hash,
} from "lucide-react";
import { SectionHeader } from "@/components/LandingPage";

/* ============================================================
 * 06 · SYSTEM — expandable rooms
 * ============================================================
 *
 * A faithful port of the `SystemGrid` component from the design repo
 * (`sonicdesk_landing_design/src/routes/index.tsx`, "06 · system"): eight
 * click-to-expand cards over a single shared detail panel, with the accent
 * radial wash, the left rail that scales in from the top, the + that rotates to
 * ×, the lift-on-hover, and the height-animated panel whose list items stagger
 * in from the left. Markup structure, class composition, transitions, spring
 * constants and delays all come from there unchanged.
 *
 * Two deliberate substitutions, both required by this repo's own rules:
 *
 *  1. CONTENT is production's. The groups, feature names, deep-dive links and
 *     per-group accents below are lifted from the live `FeatureIndex` section in
 *     `components/LandingPage.tsx`, not from the design repo's example copy. The
 *     design repo's per-group blurb line has no counterpart in production and is
 *     therefore omitted rather than invented — see the note on `SysGroup`.
 *     Two items were added on top of production's 42 so that no room is left
 *     with an odd three entries in the two-column detail grid; both are marked
 *     inline below.
 *  2. COLORS are tokens. The design repo hardcodes hexes (#a78bfa, #fbbf24, …);
 *     those are the same colors this project already exposes as `--wave-*` /
 *     `--lime`, and AGENTS.md §7 forbids hardcoded colors. Using the tokens also
 *     means the section follows the active palette instead of pinning itself to
 *     the dark one. Token equivalents for the design repo's own variables:
 *     `--color-primary` → `--lime`, `--color-border` → `--border`,
 *     `--color-muted` → `--muted-foreground`, `--color-muted-strong` →
 *     `--foreground` at 80%.
 *
 * No new dependency: `motion`, `AnimatePresence` and `useReducedMotion` are the
 * same `motion/react` APIs the existing landing page already uses.
 *
 * This component is used ONLY by the /simple A/B variant. The control landing
 * page keeps its original `FeatureIndex` grid — see AGENTS.md §4.
 */

type SysItem = {
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  href?: string;
};

type SysGroup = {
  /** "06.1" … "06.8" */
  n: string;
  /** Accent token for this room. */
  c: string;
  /** Room title. */
  t: string;
  href?: string;
  items: SysItem[];
};

const SYSTEM_GROUPS: SysGroup[] = [
  {
    n: "06.1", t: "ORGANIZATION", c: "var(--wave-violet)",
    items: [
      { label: "Bands & invite codes", icon: Users },
      { label: "Custom role tags · guitarist, vocalist, producer", icon: Tag, href: "/audience/producer" },
      { label: "Real-time activity feed", icon: Activity },
      { label: "Group statistics — versions, applies, comments", icon: BarChart3 },
    ],
  },
  {
    n: "06.2", t: "VERSIONING", c: "var(--lime)", href: "/features/versions",
    items: [
      { label: "Branch off for experiments — master mix stays untouched", icon: GitBranch, href: "/features/versions" },
      { label: "Compare any version to master · review overlaps · apply changes", icon: GitMerge, href: "/features/versions" },
      { label: "Review every difference before you apply · cherry-pick tracks, bars and comments", icon: GitCompare, href: "/features/versions" },
      { label: "Full version history · creation date and tags", icon: History, href: "/features/versions" },
    ],
  },
  {
    n: "06.3", t: "MIXER", c: "var(--wave-mint)",
    items: [
      { label: "Multi-track waveforms", icon: AudioWaveform },
      { label: "Mute · Solo · Offset · Replace", icon: Volume2 },
      { label: "Record straight into the project", icon: Mic },
      { label: "Metronome · count-in · loop section", icon: Timer },
      { label: "Range comments with threads", icon: MessageSquare, href: "/features/comments" },
      { label: "MIDI editor · draw & select · snap-to-grid · undo/redo", icon: MessageSquare },
    ],
  },
  {
    n: "06.4", t: "STRUCTURE & CHORDS", c: "var(--wave-amber)", href: "/features/structure",
    items: [
      { label: "Mark every part of the track — chorus, bridge, or super-mega-breakdown", icon: LayoutGrid, href: "/features/structure" },
      { label: "Chord-per-section · auto-detect", icon: Music2, href: "/tools/chord-detector" },
      { label: "Structure overlay above waveforms", icon: Layers, href: "/features/structure" },
      { label: "Chord chart for rehearsal", icon: ListMusic, href: "/tools/chord-detector" },
    ],
  },
  {
    n: "06.5", t: "A/B VERSION COMPARISON", c: "var(--wave-sky)", href: "/features/versions",
    items: [
      { label: "Side-by-side version comparison", icon: GitCompare, href: "/features/versions" },
      { label: "Solo individual tracks while comparing", icon: Headphones, href: "/features/versions" },
      { label: "Synced playback — hear both versions at once", icon: Play, href: "/features/versions" },
      // Fourth item so the room fills the 2-column detail grid evenly rather
      // than leaving a gap. Describes real cherry-pick behaviour (see
      // AGENTS.md §4 "Versioning" — per-track / per-bar / per-comment apply).
      { label: "Apply specific changes to the master", icon: GitMerge, href: "/features/versions" },
    ],
  },
  {
    n: "06.6", t: "RESOURCES", c: "var(--wave-coral)",
    items: [
      { label: "Attach PDFs, DAW projects, anything", icon: Paperclip },
      { label: "Links attachment", icon: Link2 },
      { label: "Pin resources to a branch or track", icon: Pin },
      { label: "Lyrics editor", icon: FileText },
      { label: "Roadmap stages · current status", icon: Compass },
      { label: "Checklist with assignments", icon: CheckSquare },
    ],
  },
  {
    n: "06.7", t: "MOBILE", c: "var(--lime-bright)", href: "/features/mobile",
    items: [
      { label: "Rehearsal view · preview mix, chords, and structure on the go", icon: Smartphone, href: "/features/mobile" },
      { label: "Mixer · work on tracks anytime, anywhere", icon: SlidersHorizontal, href: "/features/mobile" },
      { label: "Recording with built-in mic", icon: Mic, href: "/features/mobile" },
      // Fourth item, same reason as 06.5 above.
      { label: "Fullscreen mode", icon: Maximize2, href: "/features/mobile" },
    ],
  },
  {
    n: "06.8", t: "EXPORT & SHARE", c: "var(--wave-violet)",
    items: [
      { label: "WAV export", icon: FileAudio },
      { label: "Member-only project share links", icon: Share2 },
      { label: "Quick Peek — preview-mix from band page", icon: Eye },
      { label: "Per-project & per-band chat with @mentions, version & track refs", icon: Hash },
    ],
  },
];

/**
 * NOTE: production's 06 section ends with a "Deep dives" link row. It is
 * deliberately absent here — the simplified variant drops it. The same eight
 * destinations are still linked from the footer's DEEP DIVES column and from
 * individual feature items above, so nothing becomes unreachable or uncrawlable
 * on this page.
 */
/**
 * Column count of the card grid, mirroring `sm:grid-cols-2 lg:grid-cols-4`.
 *
 * Needed in JS because the detail panel is placed by grid `order`, and the row a
 * card belongs to depends on how many columns there are. Kept in sync with the
 * class list on the grid below by hand — Tailwind's `sm` is 640px and `lg` is
 * 1024px.
 */
function useGridColumns() {
  const [cols, setCols] = useState(1);

  useEffect(() => {
    const sm = window.matchMedia("(min-width: 640px)");
    const lg = window.matchMedia("(min-width: 1024px)");
    const update = () => setCols(lg.matches ? 4 : sm.matches ? 2 : 1);
    update();
    sm.addEventListener("change", update);
    lg.addEventListener("change", update);
    return () => {
      sm.removeEventListener("change", update);
      lg.removeEventListener("change", update);
    };
  }, []);

  return cols;
}

export function SystemAccordion() {
  const [open, setOpen] = useState<string | null>(null);
  const reduce = useReducedMotion();
  const cols = useGridColumns();
  const activeIndex = SYSTEM_GROUPS.findIndex((g) => g.n === open);
  const active = activeIndex >= 0 ? SYSTEM_GROUPS[activeIndex] : null;

  // The panel is a full-width grid item rather than a sibling after the grid, so
  // it opens directly beneath the row holding the card that was tapped instead
  // of at the bottom of all eight. Cards in row R take order R*2 and the panel
  // takes R*2+1; equal `order` values keep source order, so the cards within a
  // row are unaffected. On a phone the grid is one column, which makes every
  // card its own row and puts the features immediately under the one selected.
  const rowOf = (i: number) => Math.floor(i / cols);
  const panelOrder = activeIndex >= 0 ? rowOf(activeIndex) * 2 + 1 : 0;

  return (
    <section id="system" className="landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="06"
        kicker="SYSTEM"
        title="THE FULL"
        accent="STUDIO SURFACE."
        seoNote="Comments on bars, automatic chord detection, song structure tools, and a mobile mixer"
      />

      <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SYSTEM_GROUPS.map((g, i) => {
          const isOpen = open === g.n;
          return (
            <motion.button
              key={g.n}
              type="button"
              onClick={() => setOpen(isOpen ? null : g.n)}
              aria-expanded={isOpen}
              aria-controls="system-room-panel"
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-10%" }}
              transition={{ delay: reduce ? 0 : (i % 4) * 0.05, duration: 0.5 }}
              whileHover={reduce ? undefined : { y: -3 }}
              className="group relative min-w-0 overflow-hidden border p-5 text-left transition-colors duration-300"
              style={{ borderColor: isOpen ? g.c : "var(--border)", order: rowOf(i) * 2 }}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 transition-opacity duration-300"
                style={{
                  background: `radial-gradient(120% 100% at 0% 0%, ${g.c}, transparent 70%)`,
                  opacity: isOpen ? 0.14 : 0,
                }}
              />
              <span
                aria-hidden
                className="absolute left-0 top-0 h-full w-[2px] origin-top transition-transform duration-500"
                style={{ background: g.c, transform: `scaleY(${isOpen ? 1 : 0})` }}
              />
              <span className="relative mb-6 flex items-center justify-between">
                <span
                  className="font-mono-tb text-[10px] uppercase tracking-[0.22em]"
                  style={{ color: g.c }}
                >
                  {g.n}
                </span>
                <motion.span
                  animate={{ rotate: isOpen ? 45 : 0 }}
                  transition={{ type: "spring", stiffness: 320, damping: 22 }}
                  aria-hidden
                  className="font-mono-tb text-sm leading-none"
                  style={{ color: isOpen ? g.c : "var(--muted-foreground)" }}
                >
                  +
                </motion.span>
              </span>
              {/* The design repo lower-cases room titles. Production's titles
                  are upper-case and must stay that way here, so the reference's
                  `lowercase` class is deliberately not carried over — every
                  category reads starting with a capital. */}
              <h3 className="relative font-display-tb text-lg font-bold tracking-tight">
                {g.t}
              </h3>
              <p className="relative mt-4 font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground transition-colors group-hover:text-foreground">
                {g.items.length} features {isOpen ? "▲" : "▾"}
              </p>
            </motion.button>
          );
        })}

        <AnimatePresence initial={false} mode="wait">
          {active && (
            <motion.div
              key={active.n}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: reduce ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="col-span-full overflow-hidden"
              style={{ order: panelOrder }}
            >
            <div
              id="system-room-panel"
              className="relative border p-6 sm:p-8"
              style={{ borderColor: active.c }}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{ background: `linear-gradient(180deg, ${active.c}14, transparent 55%)` }}
              />
              <div className="relative flex flex-wrap items-baseline justify-between gap-4">
                <h3 className="font-display-tb text-2xl font-bold tracking-tight sm:text-3xl">
                  {active.href ? (
                    <a href={active.href} className="transition-colors hover:text-lime">
                      {active.t}
                    </a>
                  ) : (
                    active.t
                  )}
                </h3>
                <button
                  type="button"
                  onClick={() => setOpen(null)}
                  className="font-mono-tb text-[10px] uppercase tracking-[0.22em] text-muted-foreground transition-colors hover:text-lime"
                >
                  close ×
                </button>
              </div>
              <ul className="relative mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                {active.items.map(({ label, icon: Icon, href }, i) => (
                  <motion.li
                    key={label}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: reduce ? 0 : 0.08 + i * 0.06, duration: 0.4 }}
                    className="flex min-w-0 items-start gap-3 border-b border-[var(--border)] pb-3"
                  >
                    {/* The design repo prefixes each item string with a glyph and
                        renders it as the marker. Production carries a lucide icon
                        per feature instead, so the icon takes the marker slot —
                        same structure, production's own iconography. */}
                    <span
                      className="mt-[2px] shrink-0 leading-5"
                      style={{ color: active.c }}
                      aria-hidden
                    >
                      <Icon size={13} />
                    </span>
                    <span className="font-mono-tb text-[12px] leading-5 text-[color-mix(in_oklab,var(--foreground)_80%,transparent)]">
                      {href ? (
                        <a href={href} className="underline-offset-2 hover:underline">
                          {label}
                        </a>
                      ) : (
                        label
                      )}
                    </span>
                  </motion.li>
                ))}
              </ul>
            </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
