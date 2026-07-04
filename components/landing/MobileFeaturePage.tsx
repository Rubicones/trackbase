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
import {
  MobilePhoneFrame,
  MobileMixerMock,
  MobileRehearsalMock,
  MobileComparisonTable,
} from "@/components/LandingPage";

/* ============================================================
 * /features/mobile — rehearsal mode & mobile mixer
 *
 * The phone mocks are the real landing-page mockups
 * (MobileRehearsalMock / MobileMixerMock) — reused, not redrawn.
 * ============================================================ */

export default function MobileFeaturePage() {
  return (
    <SlicePage>
      <SliceNav kind="feature" label="mobile" />
      <ScopeBanner kind="feature">Rehearsal + mixer on your phone — one part of sonicdesk.</ScopeBanner>
      <Hero />
      <DualModes />
      <FeatureGrid />
      <SliceFooter kind="feature" label="mobile" />
    </SlicePage>
  );
}

function Hero() {
  return (
    <SliceHero
      pill="Feature · rehearsal mode & mobile mixer"
      title={
        <>
          THE PHONE <span className="text-lime">IS THE STUDIO.</span>
        </>
      }
    >
      Rehearsal room, kitchen table, backstage — every project opens on your phone with the tools
      that fit the moment.
    </SliceHero>
  );
}

/* --- 01 · two modes, one app --- */

function DualModes() {
  return (
    <SliceSection index="01" tag="Two modes · one app">
      <div className="grid items-start gap-8 lg:grid-cols-[1fr_auto_1fr] lg:gap-6">
        {/* Rehearsal phone */}
        <div>
          <div className="mb-4 flex items-center justify-center gap-3">
            <span className="size-2 rounded-full tb-blink" style={{ background: "var(--wave-sky)" }} />
            <span className="font-mono-tb text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--wave-sky)" }}>
              Rehearsal mode
            </span>
          </div>
          <div className="flex justify-center">
            <MobilePhoneFrame accent="var(--wave-sky)">
              <MobileRehearsalMock />
            </MobilePhoneFrame>
          </div>
        </div>

        {/* Vertical separator — same as the landing Mobile section */}
        <div className="hidden flex-col items-center gap-4 self-center lg:flex">
          <div className="h-24 w-px bg-[color-mix(in_oklab,var(--border)_80%,transparent)]" />
          <div className="rotate-90 whitespace-nowrap font-mono-tb text-[10px] uppercase tracking-[0.18em] text-lime">
            Two modes · one project
          </div>
          <div className="h-24 w-px bg-[color-mix(in_oklab,var(--border)_80%,transparent)]" />
        </div>

        {/* Mixer phone */}
        <div>
          <div className="mb-4 flex items-center justify-center gap-3">
            <span className="size-2 rounded-full bg-lime tb-blink" />
            <span className="font-mono-tb text-[10px] uppercase tracking-[0.18em] text-lime">
              Mobile mixer
            </span>
          </div>
          <div className="flex justify-center">
            <MobilePhoneFrame accent="var(--lime)">
              <MobileMixerMock />
            </MobilePhoneFrame>
          </div>
        </div>
      </div>

      {/* Capability table — same as the landing Mobile section */}
      <MobileComparisonTable className="mt-16" />
    </SliceSection>
  );
}

/* --- 02 · built for rehearsal, not marketing --- */

function FeatureGrid() {
  return (
    <SliceSection index="02" tag="Built for rehearsal, not marketing">
      <SliceCardGrid
        className="md:grid-cols-3"
        titleClassName="text-xl"
        items={[
          {
            title: "Chord now · chord next",
            desc: "Giant, readable across the room. No squinting mid-song.",
          },
          {
            title: "Autoscroll lyrics",
            desc: "Adjustable speed, active-line highlight. Hands-free.",
          },
          {
            title: "Metro · count-in · loop",
            desc: "Practice a bar or a chorus — locked to project BPM.",
          },
          {
            title: "Fullscreen mode",
            desc: "Everything but the chart disappears. Eyes on the music.",
          },
          {
            title: "Record on mobile",
            desc: "Capture the idea before it's gone. Lands in the current version.",
          },
          {
            title: "Mute/solo per track",
            desc: "Isolate a part while you learn — same mixer as desktop.",
          },
        ]}
      />
    </SliceSection>
  );
}
