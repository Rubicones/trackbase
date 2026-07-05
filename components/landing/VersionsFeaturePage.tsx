"use client";

import { motion } from "motion/react";
import {
  SlicePage,
  SliceNav,
  ScopeBanner,
  SliceFooter,
  SliceSection,
  SliceHeadline,
  SliceMono,
  SlicePill,
} from "@/components/landing/SliceChrome";
import { BranchBoard } from "@/components/LandingPage";
import { SeededWaveform } from "@/components/WaveformBars";

/* ============================================================
 * /features/versions — branch it, compare it, merge it back
 *
 * The version tree + diff board is the real landing-page BranchBoard —
 * reused, not redrawn. The A/B compare block below is a simplified
 * copy of the actual CompareMode interface (components/CompareMode.tsx).
 * ============================================================ */

export default function VersionsFeaturePage() {
  return (
    <SlicePage>
      <SliceNav kind="feature" label="versions" />
      <ScopeBanner kind="feature">Version control is one of many tools inside sonicdesk</ScopeBanner>
      <Hero />
      <Theatre />
      <Compare />
      <Apply />
      <SliceFooter kind="feature" label="versions & a/b" />
    </SlicePage>
  );
}

/* --- hero (subtitle fades in separately, matching the design) --- */

function Hero() {
  return (
    <section className="relative px-4 pt-14 pb-12 sm:px-6 sm:pt-20">
      <div aria-hidden className="tb-grid-bg-landing pointer-events-none absolute inset-0 landing-abs-bleed" />
      <div className="relative mx-auto w-full max-w-[1400px]">
        <SlicePill>Feature · versions & A/B compare</SlicePill>
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="mt-6 font-display-tb text-[clamp(3rem,11vw,9rem)] font-bold leading-[0.85] tracking-[-0.045em] text-balance"
        >
          BRANCH IT. <span className="text-lime">COMPARE IT.</span> MERGE IT BACK.
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.9 }}
          className="mt-6 max-w-2xl font-mono-tb text-[12px] leading-relaxed text-muted-foreground"
        >
          Copy master into a fresh version, experiment freely, then hold two versions side-by-side
          and pick the winner. Nothing lost, no{" "}
          <span className="text-foreground">_final_v3_FINAL.wav</span> — ever.
        </motion.p>
      </div>
    </section>
  );
}

/* --- 01 · version tree (reused landing BranchBoard) --- */

function Theatre() {
  return (
    <SliceSection index="01" tag="Version tree · auto-rotating">
      <SliceHeadline>
        EVERY TAKE, KEPT. <span className="text-lime">EVERY DIFF, VISIBLE.</span>
      </SliceHeadline>
      <SliceMono className="mt-6 max-w-lg">
        Each version has its own tracks, structure, chords and comments. No folders on your
        desktop, no naming wars.
      </SliceMono>
      <BranchBoard className="mt-10" />
    </SliceSection>
  );
}

/* --- 02 · A/B compare — simplified copy of the real CompareMode --- */

const COMPARE_CHANNELS = [
  { n: "BASS", seedA: 3, seedB: 8 },
  { n: "DRUMS", seedA: 4, seedB: 9 },
  { n: "KEYS", seedA: 5, seedB: 10 },
  { n: "VOX", seedA: 6, seedB: 11 },
];

function CompareMS() {
  return (
    <div className="flex shrink-0 gap-1">
      {["M", "S"].map((b) => (
        <span
          key={b}
          className="grid size-4 place-items-center border border-border font-mono-tb text-[8px] text-muted-foreground"
        >
          {b}
        </span>
      ))}
    </div>
  );
}

function CompareSide({
  side,
  name,
  chip,
  color,
  colorForeground,
  seedKey,
}: {
  side: "A" | "B";
  name: string;
  chip: string;
  color: string;
  colorForeground: string;
  seedKey: "seedA" | "seedB";
}) {
  return (
    <div className="min-w-0 flex-1 border-r border-[color-mix(in_oklab,var(--border)_80%,transparent)] last:border-r-0">
      <div className="flex items-center justify-between gap-2 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] px-3 py-2 font-mono-tb text-[10px] uppercase tracking-[0.18em]">
        <span className="flex min-w-0 items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate">
            {side} · <span className="text-foreground">{name}</span>
          </span>
        </span>
        <span className="shrink-0 border border-border px-2 py-0.5" style={{ color }}>
          {chip}
        </span>
      </div>
      <div className="space-y-2 p-3">
        {COMPARE_CHANNELS.map((t) => (
          <div key={t.n} className="flex items-center gap-2">
            <CompareMS />
            <div className="h-5 min-w-0 flex-1">
              <SeededWaveform seed={t[seedKey]} bars={60} color={color} height={20} progress={0.55} />
            </div>
          </div>
        ))}
        <div className="mt-3 flex items-center justify-between border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] pt-3">
          <span className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            1 comment on bar 34
          </span>
          <button
            type="button"
            className="px-3 py-1.5 font-mono-tb text-[10px] uppercase tracking-[0.18em]"
            style={{ background: color, color: colorForeground }}
          >
            Use this →
          </button>
        </div>
      </div>
    </div>
  );
}

function Compare() {
  return (
    <SliceSection index="02" tag="A/B compare · face-to-face">
      <SliceHeadline>
        HEAR THE DIFFERENCE, <span className="text-lime">NOT THE DEBATE.</span>
      </SliceHeadline>
      <SliceMono className="mt-6 max-w-2xl">
        Pin two versions side by side. Per-track mute & solo. Sync-playhead. Structure and
        comments stacked from both. One click:{" "}
        <span className="text-foreground">use this version</span>.
      </SliceMono>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="mt-10 border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_30%,transparent)]"
      >
        {/* A/B compare bar — mirrors the real CompareMode toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] px-4 py-2">
          <span className="shrink-0 font-mono-tb text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            // A/B Compare
          </span>
          <div className="flex shrink-0 border border-border font-mono-tb text-[9px] uppercase tracking-[0.18em]">
            <span className="border-r border-border bg-lime px-2.5 py-1 text-primary-foreground">A</span>
            <span className="flex items-center gap-1 border-r border-border px-2.5 py-1 text-muted-foreground">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                <path d="M1 5h8M5 1l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Sync play
            </span>
            <span className="px-2.5 py-1 text-muted-foreground">B</span>
          </div>
          <span className="shrink-0 border border-border px-2.5 py-1 font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            Loop Off
          </span>
          <span className="ml-auto shrink-0 border border-lime bg-lime px-3 py-1.5 font-mono-tb text-[9px] font-bold uppercase tracking-[0.18em] text-primary-foreground">
            ← Exit Compare
          </span>
        </div>

        {/* Side A + Side B panes */}
        <div className="flex flex-col md:flex-row">
          <CompareSide
            side="A"
            name="master"
            chip="READY"
            color="var(--lime)"
            colorForeground="var(--primary-foreground)"
            seedKey="seedA"
          />
          <CompareSide
            side="B"
            name="new-bridge"
            chip="MUTED"
            color="var(--compare-b)"
            colorForeground="var(--compare-b-foreground)"
            seedKey="seedB"
          />
        </div>
      </motion.div>
    </SliceSection>
  );
}

/* --- 03 · apply, with a visible diff --- */

function Apply() {
  return (
    <SliceSection index="03" tag="Apply · with a visible diff">
      <div className="grid gap-6 md:grid-cols-3">
        {[
          { k: "01", t: "BRANCH", d: "New version · full copy of master · your own sandbox." },
          { k: "02", t: "COMPARE", d: "A/B side-by-side · sync play · per-track mute/solo." },
          { k: "03", t: "APPLY", d: "One click into master · every change logged forever." },
        ].map((s, i) => (
          <motion.div
            key={s.k}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1 }}
            className="border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-6 transition-colors hover:border-[color-mix(in_oklab,var(--lime)_60%,transparent)]"
          >
            <span className="font-mono-tb text-[10px] uppercase tracking-[0.35em] text-lime">{s.k}</span>
            <div className="mt-3 font-display-tb text-3xl font-bold tracking-tight">{s.t}</div>
            <div className="mt-3 font-mono-tb text-[11px] leading-relaxed text-muted-foreground">{s.d}</div>
          </motion.div>
        ))}
      </div>
    </SliceSection>
  );
}
