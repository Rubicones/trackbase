"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import {
  SlicePage,
  SliceNav,
  ScopeBanner,
  SliceFooter,
  SliceSection,
  SliceHero,
  SliceHeadline,
  SliceMono,
  SliceCardGrid,
} from "@/components/landing/SliceChrome";

/* ============================================================
 * /audience/cover-band — one chart, everyone playing it
 * ============================================================ */

export default function CoverBandPage() {
  return (
    <SlicePage>
      <SliceNav kind="audience" label="cover band" />
      <ScopeBanner kind="audience">This page is a slice · one story of many.</ScopeBanner>
      <Hero />
      <Problem />
      <Solution />
      <SliceFooter kind="audience" label="cover band" />
    </SlicePage>
  );
}

function Hero() {
  return (
    <SliceHero
      pill="Audience · cover band · learn fast, together"
      title={
        <>
          ONE CHART. <span className="text-lime">EVERYONE PLAYING IT.</span>
        </>
      }
    >
      For the band that learns 12 new songs in three weeks — and can&apos;t afford to spend
      rehearsal arguing which chord goes in the bridge.
    </SliceHero>
  );
}

/* --- 01 · the problem, visualized --- */

const BOOKS = [
  { who: "guitarist", chord: "Bbm", color: "var(--wave-coral)" },
  { who: "bassist", chord: "Bb", color: "var(--wave-violet)" },
  { who: "keys", chord: "B", color: "var(--wave-sky)" },
];

function Problem() {
  const [merged, setMerged] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setMerged((v) => !v), 3800);
    return () => clearInterval(id);
  }, []);
  return (
    <SliceSection index="01" tag="The problem, visualized">
      <SliceHeadline>
        THREE BOOKS. <span className="text-[var(--wave-coral)]">THREE CHORDS.</span> ONE BRIDGE.
      </SliceHeadline>
      <SliceMono className="mt-6 max-w-xl">
        Each player brings their own songbook to rehearsal. Everyone is technically right. No one
        is playing the same song.
      </SliceMono>
      <div className="relative mt-10 flex min-h-[240px] items-center justify-center">
        {BOOKS.map((b, i) => (
          <motion.div
            key={b.who}
            animate={
              merged
                ? { x: 0, y: 0, rotate: 0, opacity: 0.15, scale: 0.85 }
                : { x: (i - 1) * 180, y: i % 2 ? -20 : 20, rotate: (i - 1) * 6, opacity: 1, scale: 1 }
            }
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="absolute border-2 bg-background px-6 py-8 text-center"
            style={{ borderColor: b.color }}
          >
            <div className="font-mono-tb text-[10px] uppercase tracking-[0.18em]" style={{ color: b.color }}>
              {b.who}&apos;s book
            </div>
            <div className="mt-2 font-display-tb text-5xl font-bold tracking-tight" style={{ color: b.color }}>
              {b.chord}
            </div>
            <div className="mt-2 font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              Bridge · bar 33
            </div>
          </motion.div>
        ))}
        <motion.div
          animate={merged ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.7 }}
          className="absolute border-2 border-lime bg-[color-mix(in_oklab,var(--lime)_10%,transparent)] px-8 py-10 text-center"
        >
          <div className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-lime">
            sonicdesk · project chart
          </div>
          <div className="mt-2 font-display-tb text-6xl font-bold tracking-tight text-lime">Bbm</div>
          <div className="mt-2 font-mono-tb text-[9px] uppercase tracking-[0.18em] text-foreground">
            Bridge · bar 33 · agreed
          </div>
        </motion.div>
      </div>
      <div className="mt-4 text-center font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        ↻ Auto-merges every 4s
      </div>
    </SliceSection>
  );
}

/* --- 02 · how sonicdesk fixes it --- */

function Solution() {
  return (
    <SliceSection index="02" tag="How sonicdesk fixes it">
      <SliceHeadline>
        LESS ARGUING. <span className="text-lime">MORE PLAYING.</span>
      </SliceHeadline>
      <SliceCardGrid
        items={[
          {
            title: "Structure & chords",
            desc: "One chart over the timeline. Everyone reads the same bar-by-bar map.",
            href: "/features/structure",
          },
          {
            title: "Auto-detect",
            desc: "Drop the audio, chords come out. Tweak the ambiguous ones by hand.",
          },
          {
            title: "Resources per project",
            desc: "Attach the original, the tab, the YouTube link, the PDF. Never lose them again.",
          },
          {
            title: "Rehearsal mode on phone",
            desc: "Giant chord-now/chord-next, autoscroll lyrics, count-in — no laptop.",
            href: "/features/mobile",
          },
          {
            title: "Loop a section",
            desc: "Chorus 2× until it clicks. Metronome locked to project BPM.",
          },
          {
            title: "Set list per band",
            desc: "Twelve songs, one dashboard. Jump from song to song in seconds.",
          },
        ]}
      />
    </SliceSection>
  );
}
