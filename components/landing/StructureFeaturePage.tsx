"use client";

import {
  SlicePage,
  SliceNav,
  ScopeBanner,
  SliceFooter,
  SliceSection,
  SliceHero,
  SliceCardGrid,
} from "@/components/landing/SliceChrome";
import { StructureDemo } from "@/components/LandingPage";

/* ============================================================
 * /features/structure — the song, mapped
 *
 * The timeline mock is the real landing-page StructureDemo
 * (auto-advancing chord board with loop-the-chorus) — reused, not redrawn.
 * ============================================================ */

export default function StructureFeaturePage() {
  return (
    <SlicePage>
      <SliceNav kind="feature" label="structure & chords" />
      <ScopeBanner kind="feature">The song map — one of many tools inside sonicdesk</ScopeBanner>
      <Hero />
      <Timeline />
      <Details />
      <SliceFooter kind="feature" label="structure & chords" />
    </SlicePage>
  );
}

function Hero() {
  return (
    <SliceHero
      pill="Feature · structure & chords"
      title={
        <>
          THE SONG, <span className="text-lime">MAPPED.</span>
        </>
      }
    >
      Sections over the timeline. Chords under every bar. Auto-detect from audio, edit by drag,
      share with the band. No more three-versions-of-the-chord-chart.
    </SliceHero>
  );
}

/* --- 01 · live structure board --- */

function Timeline() {
  return (
    <SliceSection index="01" tag="Live · structure & chords over the timeline">
      <StructureDemo />
    </SliceSection>
  );
}

/* --- 02 · edit · share · rehearse --- */

function Details() {
  return (
    <SliceSection index="02" tag="Edit · share · rehearse">
      <SliceCardGrid
        className="md:grid-cols-2 lg:grid-cols-4"
        titleClassName="text-xl"
        delayStep={0.06}
        items={[
          {
            title: "Drag to resize",
            desc: "Extend chorus to 8 bars — grab an edge, drop it. Everyone sees it.",
          },
          {
            title: "Auto-detect chords",
            desc: "Run detection on the master audio, then tweak by hand.",
          },
          {
            title: "Per-version structure",
            desc: "Half-time bridge branch keeps its own map — A/B shows both stacked.",
          },
          {
            title: "Rehearsal-ready",
            desc: "Sections and chords beam straight into the mobile rehearsal view.",
          },
        ]}
      />
    </SliceSection>
  );
}
