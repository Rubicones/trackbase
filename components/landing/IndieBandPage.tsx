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
 * /audience/indie-band — the band lives in one place
 * ============================================================ */

export default function IndieBandPage() {
  return (
    <SlicePage>
      <SliceNav kind="audience" label="indie band" />
      <ScopeBanner kind="audience">This page is a slice · one story of many.</ScopeBanner>
      <Hero />
      <Problem />
      <Solution />
      <SliceFooter kind="audience" label="indie band" />
    </SlicePage>
  );
}

function Hero() {
  return (
    <SliceHero
      pill="Audience · indie band · online + IRL"
      title={
        <>
          THE BAND LIVES <span className="text-lime">IN ONE PLACE.</span>
        </>
      }
    >
      For the four of you who write in a Discord DM, rehearse on Thursdays, and can never agree
      on which <span className="text-foreground">draft_final_2.wav</span> is actually final.
    </SliceHero>
  );
}

/* --- 01 · the problem, visualized --- */

const CHAOS = [
  "vox_v1.wav",
  "vox_v2_FINAL.wav",
  "vox_v2_FINAL_real.wav",
  "mix_thur.mp3",
  "mix_thur_ELIAS_edit.mp3",
  "mix_FINAL_v3.mp3",
  "guitar_take7.wav",
  "guitar_TAKE7_reamp.wav",
  "🎙️ voice-note-42s.ogg",
];

/** Mirrors the version tree rows from the landing BranchBoard mock. */
const SORTED_VERSIONS = [
  { n: "main", t: "MASTER", c: "var(--lime)" },
  { n: "vocals-alt", t: "EXP", c: "var(--wave-violet)" },
  { n: "half-time-outro", t: "ARR", c: "var(--wave-sky)" },
  { n: "darker-mix", t: "FIX", c: "var(--wave-coral)" },
];

function Problem() {
  const [fixed, setFixed] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setFixed((f) => !f), 4200);
    return () => clearInterval(id);
  }, []);
  return (
    <SliceSection index="01" tag="The problem, visualized">
      <SliceHeadline>
        RIGHT NOW IT LOOKS LIKE <span className="text-[var(--wave-coral)]">THIS.</span>
      </SliceHeadline>
      <SliceMono className="mt-6 max-w-xl">
        Files scatter across drives, chats and voice notes. No one knows which take is the take.
      </SliceMono>
      <div className="mt-8 grid items-stretch gap-6 lg:grid-cols-2">
        <motion.div
          animate={fixed ? { opacity: 0.35, filter: "blur(3px)" } : { opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.6 }}
          className="relative min-h-[280px] overflow-hidden border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-4"
        >
          <div className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            /downloads/band
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {CHAOS.map((f, i) => (
              <motion.span
                key={f}
                animate={{ x: [0, i % 2 ? 4 : -4, 0], y: [0, i % 3 ? -3 : 3, 0] }}
                transition={{ duration: 3 + (i % 3), repeat: Infinity, delay: i * 0.1 }}
                className="border border-[color-mix(in_oklab,var(--wave-coral)_40%,transparent)] px-2 py-1 font-mono-tb text-[10px] text-[var(--wave-coral)]"
              >
                {f}
              </motion.span>
            ))}
          </div>
          <div className="absolute right-3 bottom-3 font-mono-tb text-[9px] uppercase tracking-[0.18em] text-[var(--wave-coral)]">
            Chaos · 09 files · 3 finals
          </div>
        </motion.div>
        <motion.div
          animate={fixed ? { opacity: 1 } : { opacity: 0.4 }}
          transition={{ duration: 0.6 }}
          className="relative min-h-[280px] border border-lime bg-[color-mix(in_oklab,var(--lime)_5%,transparent)] p-4"
        >
          <div className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-lime">
            sonicdesk. · northern room
          </div>
          <div className="mt-3 space-y-1.5">
            {SORTED_VERSIONS.map((v) => (
              <div
                key={v.n}
                className="grid grid-cols-[10px_1fr_auto] items-center gap-2 border-b border-[color-mix(in_oklab,var(--border)_60%,transparent)] py-1.5 last:border-0"
              >
                <span className="size-2 rounded-full" style={{ background: v.c }} />
                <span className="font-mono-tb text-[11px] text-foreground">{v.n}</span>
                <span className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                  {v.t}
                </span>
              </div>
            ))}
          </div>
          <div className="absolute right-3 bottom-3 font-mono-tb text-[9px] uppercase tracking-[0.18em] text-lime">
            ✓ One truth · 4 versions
          </div>
        </motion.div>
      </div>
      <div className="mt-4 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        ↻ Auto-switches every 4s
      </div>
    </SliceSection>
  );
}

/* --- 02 · how sonicdesk. fixes it --- */

function Solution() {
  return (
    <SliceSection index="02" tag="How sonicdesk. fixes it">
      <SliceHeadline>
        FROM SCATTERED <span className="text-lime">TO SORTED.</span>
      </SliceHeadline>
      <SliceCardGrid
        items={[
          {
            title: "Version control",
            desc: "Every take kept · every branch a full copy · never lose a good idea again.",
            href: "/features/versions",
          },
          {
            title: "Comments on bars",
            desc: "“The snare after bar 34 is dry” — pinned to the bar, not lost in Telegram.",
            href: "/#features",
          },
          {
            title: "Project chat",
            desc: "One thread per project · tag your drummer · deep-link to any track.",
          },
          {
            title: "Quick peek",
            desc: "Band member without the app? Share the whole project via a link they can play.",
          },
          {
            title: "Activity feed",
            desc: "Who did what, when. “I thought you fixed that” — becomes provable.",
          },
          {
            title: "Mobile companion",
            desc: "Record the idea on your phone before the bus stops. Lands in the current version.",
            href: "/features/mobile",
          },
        ]}
      />
    </SliceSection>
  );
}
