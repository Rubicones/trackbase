"use client";

import { motion } from "motion/react";
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
import { SeededWaveform } from "@/components/WaveformBars";

/* ============================================================
 * /features/comments — comments on bars, not "around 1:40"
 *
 * Target intent: "comments on tracks", "timestamped track comments",
 * "comments on bars", "feedback tool for music".
 * ============================================================ */

export default function CommentsFeaturePage() {
  return (
    <SlicePage>
      <SliceNav kind="feature" label="comments" />
      <ScopeBanner kind="feature">Comments on bars are one of many tools inside sonicdesk.</ScopeBanner>
      <Hero />
      <Theatre />
      <HowItWorks />
      <Different />
      <SliceFooter kind="feature" label="comments on bars" />
    </SlicePage>
  );
}

function Hero() {
  return (
    <SliceHero
      pill="Feature · comments on bars"
      title={
        <>
          COMMENT ON <span className="text-lime">BAR 34.</span> NOT &quot;AROUND 1:40&quot;.
        </>
      }
    >
      Timestamped track comments, anchored to the exact bar or range they&apos;re about. Tag a
      bandmate, reply in a thread, resolve when it&apos;s fixed. Feedback lives on the track —
      not in a chat scrollback.
    </SliceHero>
  );
}

/* --- 01 · the comment thread, on the waveform --- */

const THREAD = [
  {
    who: "MA",
    name: "marek",
    when: "2h",
    text: "This section feels slightly off — anyone else hearing it drift on the second half?",
  },
  {
    who: "AV",
    name: "ava",
    when: "1h",
    text: "@marek yes — bar 36 specifically. The ride is rushing against the click.",
  },
  {
    who: "EL",
    name: "elias",
    when: "12m",
    text: "Re-cut in v1.5, linked here. Resolving once you both confirm.",
  },
];

function Theatre() {
  return (
    <SliceSection index="01" tag="Range comments · threaded">
      <SliceHeadline>
        THE NOTE STICKS <span className="text-lime">TO THE MUSIC.</span>
      </SliceHeadline>
      <SliceMono className="mt-6 max-w-lg">
        Select a range on any track&apos;s waveform, drop a comment. Every reply, mention and
        resolution stays pinned to bars 34–38 — in every version it applies to.
      </SliceMono>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="mt-10 border border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_30%,transparent)]"
      >
        {/* toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color-mix(in_oklab,var(--border)_80%,transparent)] bg-[color-mix(in_oklab,var(--card)_40%,transparent)] px-4 py-2 font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>NORTHERN ROOM · GTR-SOLO · v1.4</span>
          <span className="border border-lime px-2 py-0.5 text-lime">COMMENT MODE</span>
        </div>

        {/* waveform + highlighted range */}
        <div className="relative px-4 py-5">
          <div className="h-10">
            <SeededWaveform seed={7} bars={90} color="var(--lime)" height={40} progress={0.42} />
          </div>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-3 left-[38%] w-[16%] border-x border-lime bg-[color-mix(in_oklab,var(--lime)_12%,transparent)]"
          />
          <div className="mt-2 flex justify-between font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            <span>1:14</span>
            <span className="text-lime">BAR 34 – 38 · SELECTED</span>
            <span>2:12</span>
          </div>
        </div>

        {/* thread */}
        <div className="space-y-3 border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] p-4">
          {THREAD.map((c, i) => (
            <motion.div
              key={c.name}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15 }}
              className="flex gap-3"
            >
              <span className="grid size-7 shrink-0 place-items-center border border-border font-mono-tb text-[9px] text-lime">
                {c.who}
              </span>
              <div className="min-w-0">
                <div className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  @{c.name} · {c.when}
                </div>
                <p className="mt-1 font-mono-tb text-[11px] leading-relaxed text-foreground">
                  {c.text}
                </p>
              </div>
            </motion.div>
          ))}
          <div className="flex items-center justify-between border-t border-[color-mix(in_oklab,var(--border)_80%,transparent)] pt-3 font-mono-tb text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <span>@mention · attach · link version</span>
            <span className="border border-border px-2 py-1 text-lime">✓ RESOLVE</span>
          </div>
        </div>
      </motion.div>
    </SliceSection>
  );
}

/* --- 02 · how it works --- */

function HowItWorks() {
  return (
    <SliceSection index="02" tag="How it works">
      <SliceHeadline>
        FEEDBACK WITH <span className="text-lime">COORDINATES.</span>
      </SliceHeadline>
      <SliceCardGrid
        items={[
          {
            title: "Range comments",
            desc: "Anchor a note to an exact bar or time range on any track's waveform — not a whole file, not a vague timestamp.",
          },
          {
            title: "Threaded replies",
            desc: "Every comment is a thread. Discussion stays attached to the moment it's about instead of scattering across chats.",
          },
          {
            title: "@mentions",
            desc: "Tag the drummer on the drum take. They get pinged with a deep link straight to the bar.",
          },
          {
            title: "Resolve & pin",
            desc: "Fixed it? Resolve the thread. Important? Pin it. The track stays readable as feedback piles up.",
          },
          {
            title: "Linked to versions",
            desc: "Reference the exact version a note applies to — so \"fixed in v1.5\" is a link, not a claim.",
            href: "/features/versions",
          },
          {
            title: "Per-track threads",
            desc: "Comments live on the specific track — guitar notes on the guitar stem, vocal notes on the vocal.",
          },
        ]}
      />
    </SliceSection>
  );
}

/* --- 03 · vs plain timestamped comments --- */

function Different() {
  return (
    <SliceSection index="03" tag="Why bars beat timestamps">
      <SliceHeadline>
        BARS ARE <span className="text-lime">MUSICAL.</span> TIMESTAMPS AREN&apos;T.
      </SliceHeadline>
      <SliceMono className="mt-6 max-w-2xl">
        Plenty of tools can pin a note to 1:41. But your band doesn&apos;t think in seconds — it
        thinks in bars, sections and chords. In sonicdesk. a comment on bar 34 knows it&apos;s in
        the second chorus, over an F, in version 1.4.
      </SliceMono>
      <SliceCardGrid
        className="md:grid-cols-3"
        items={[
          {
            title: "Musical context",
            desc: "Comments understand the song structure — chorus, bridge, breakdown — because structure is a first-class object.",
            href: "/features/structure",
          },
          {
            title: "Version-aware",
            desc: "A note about the old bridge doesn't haunt the new one. Comments travel with the version they were made on.",
            href: "/features/versions",
          },
          {
            title: "One workspace",
            desc: "The same bars carry chords, structure, and rehearsal loops — feedback is part of the workspace, not a separate review app.",
          },
        ]}
      />
    </SliceSection>
  );
}
