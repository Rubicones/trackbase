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
 * /audience/producer — no more _final_v3_FINAL.wav
 * ============================================================ */

export default function ProducerPage() {
  return (
    <SlicePage>
      <SliceNav kind="audience" label="producer" />
      <ScopeBanner kind="audience">This page is a slice · one story of many.</ScopeBanner>
      <Hero />
      <Problem />
      <Solution />
      <SliceFooter kind="audience" label="producer + collab" />
    </SlicePage>
  );
}

function Hero() {
  return (
    <SliceHero
      pill="Audience · in-house producer + collaborator"
      title={
        <>
          NO MORE <span className="text-lime">_final_v3_FINAL.wav</span>
        </>
      }
    >
      You produce. She sings. He plays bass. Every session it&apos;s a new email, a new Dropbox
      link, a new question of &quot;where do I upload this?&quot;. Here&apos;s a workspace that
      answers.
    </SliceHero>
  );
}

/* --- 01 · the problem, visualized --- */

const PING_PONG = [
  { from: "you", to: "vox", file: "mix_v1.wav", color: "var(--wave-violet)" },
  { from: "vox", to: "you", file: "vox_take_v1.wav", color: "var(--wave-coral)" },
  { from: "you", to: "vox", file: "mix_v2_FINAL.wav", color: "var(--wave-violet)" },
  { from: "vox", to: "you", file: "vox_v2_FINAL_real.wav", color: "var(--wave-coral)" },
  { from: "you", to: "vox", file: "mix_v3_FINAL_final.wav", color: "var(--wave-violet)" },
];

function Problem() {
  const [i, setI] = useState(0);
  const [solved, setSolved] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      setI((v) => {
        if (v + 1 >= PING_PONG.length) {
          // Latch: once the "same room" card has appeared, it stays visible
          // while the ping-pong loop keeps cycling behind it.
          setSolved(true);
          return 0;
        }
        return v + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <SliceSection index="01" tag="The problem, visualized">
      <SliceHeadline>
        THE ETERNAL <span className="text-[var(--wave-coral)]">BACK AND FORTH.</span>
      </SliceHeadline>
      <SliceMono className="mt-6 max-w-xl">
        Files bouncing between inboxes. No history. No context. No idea which take was the last
        one anyone actually approved.
      </SliceMono>

      <div className="mt-10 grid min-h-[240px] grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="h-full border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-4">
          <div className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            You · producer
          </div>
          <div className="mt-3 space-y-1">
            {PING_PONG.filter((p) => p.from === "you")
              .slice(0, i + 1)
              .map((p, k) => (
                <div
                  key={k}
                  className="border px-2 py-1 font-mono-tb text-[10px]"
                  style={{ borderColor: p.color, color: p.color }}
                >
                  {p.file}
                </div>
              ))}
          </div>
        </div>
        <div className="relative h-24 w-32">
          <motion.div
            key={i}
            initial={{ x: PING_PONG[i].from === "you" ? -60 : 60, opacity: 0 }}
            animate={{ x: PING_PONG[i].from === "you" ? 60 : -60, opacity: [0, 1, 1, 0] }}
            transition={{ duration: 0.9 }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border px-2 py-1 font-mono-tb text-[9px] whitespace-nowrap"
            style={{ borderColor: PING_PONG[i].color, color: PING_PONG[i].color }}
          >
            {PING_PONG[i].file}
          </motion.div>
          <div className="absolute inset-0 flex items-center justify-center font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            ↔
          </div>
        </div>
        <div className="h-full border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] p-4">
          <div className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Vocalist
          </div>
          <div className="mt-3 space-y-1">
            {PING_PONG.filter((p) => p.from === "vox")
              .slice(0, Math.max(0, Math.floor((i + 1) / 2)))
              .map((p, k) => (
                <div
                  key={k}
                  className="border px-2 py-1 font-mono-tb text-[10px]"
                  style={{ borderColor: p.color, color: p.color }}
                >
                  {p.file}
                </div>
              ))}
          </div>
        </div>
      </div>

      <motion.div
        animate={solved ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
        transition={{ duration: 0.6 }}
        className="mt-6 border border-lime bg-[color-mix(in_oklab,var(--lime)_10%,transparent)] p-6"
      >
        <div className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-lime">
          ↳ sonicdesk. · one project · one URL
        </div>
        <div className="mt-2 font-display-tb text-3xl font-bold tracking-tight">
          Both of you working in <span className="text-lime">the same room.</span>
        </div>
        <div className="mt-2 font-mono-tb text-[11px] leading-relaxed text-muted-foreground">
          She uploads her take into the vox track. You version the mix. Every step is logged. No
          email needed.
        </div>
      </motion.div>
    </SliceSection>
  );
}

/* --- 02 · how sonicdesk. fixes it --- */

function Solution() {
  return (
    <SliceSection index="02" tag="How sonicdesk. fixes it">
      <SliceHeadline>
        ONE PROJECT. <span className="text-lime">ONE TRUTH.</span>
      </SliceHeadline>
      <SliceCardGrid
        items={[
          {
            title: "Shared workspace",
            desc: "One URL. Every collaborator uploads into the right slot. No more “where do I put this?”",
          },
          {
            title: "Versioning",
            desc: "Every mix a version. Compare A/B. Apply the winner back to master.",
            href: "/features/versions",
          },
          {
            title: "Comments on bars",
            desc: "“Tighten the vocal doubler at bar 22” — pinned exactly there.",
            href: "/#features",
          },
          {
            title: "Activity log",
            desc: "Who uploaded what, when. A full paper trail for every decision.",
          },
          {
            title: "Roles & access",
            desc: "Vocalist sees her tracks. You see everything. No chaos, no lockouts.",
          },
          {
            title: "Export WAV",
            desc: "When it's done, one click. Bounce master or any branch.",
          },
        ]}
      />
    </SliceSection>
  );
}
