"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import {
  TopBar,
  BranchShowcase,
  SectionHeader,
  FeaturePanel,
  CommentsDemo,
  StructureDemo,
  SocialDemo,
  MobileSection,
  Philosophy,
  ThemingSection,
  FAQ,
  CTA,
  Footer,
  GhostButton,
  Marquee,
  useMounted,
  type LandingNavItem,
} from "@/components/LandingPage";
import { HeroVersionGraphFluid } from "@/components/landing/HeroVersionGraphFluid";
import { SystemAccordion } from "@/components/landing/SystemAccordion";
import { LandingVariantEvent } from "@/components/landing/LandingVariantEvent";
import { useLandingAuth } from "@/hooks/useLandingAuth";
import { isRunningAsInstalledPWA } from "@/lib/pwa";

/* ============================================================
 * SIMPLIFIED LANDING PAGE — A/B variant `simple`
 * ============================================================
 *
 * The stripped-back counterpart to `components/LandingPage.tsx`, served at
 * `/simple` and rewritten onto `/` for half of first-time visitors (see
 * `lib/landingVariant.ts` and `middleware.ts`).
 *
 * How it relates to the control page:
 *
 *  * SHARED, one component, no copies — all the primitives (`SectionHeader`,
 *    `GhostButton`, the feature demos, the phone mocks), which are imported
 *    rather than reimplemented.
 *  * SHARED WITH A FLAG — 01 · Versions & Diff, 03 · Mobile, 04 · Philosophy,
 *    05 · Theming and 08 · FAQ differ from the control page by exactly one
 *    omission or one presentational rule each. Each takes an optional prop
 *    whose default is the control behaviour, so those sections stay a single
 *    implementation and `/` is unaffected by anything here.
 *  * VARIANT-ONLY components, defined below — `SimpleHero` and `SimpleFeatures`
 *    differ structurally, so they are separate components local to this file.
 *    Editing either cannot reach the control page.
 *  * REDESIGNED — 06 · System is `SystemAccordion`, ported from the design repo
 *    and used only here. The control page keeps its original `FeatureIndex`.
 *  * REMOVED — 07 · Roadmap does not appear on this variant, and is dropped from
 *    the nav below so the header and footer can't link to a section that isn't
 *    on the page.
 */

/**
 * Nav for this variant: the control page's list minus ROADMAP.
 *
 * `TopBar` and `Footer` both derive from this, so the header nav, the mobile
 * section wheel and the footer's PRODUCT column can never point at a section
 * this page doesn't render.
 */
const SIMPLE_NAV_ITEMS: LandingNavItem[] = [
  ["#top", "HOME"],
  ["#versioning", "VERSIONING"],
  ["#features", "FEATURES"],
  ["#mobile", "MOBILE"],
  ["#philosophy", "PHILOSOPHY"],
  ["#themes", "THEMES"],
  ["#system", "SYSTEM"],
  ["#faq", "FAQ"],
];

/* ============================================================
 * Hero — variant-only
 * ============================================================ */

/**
 * Simplified hero — four elements, top to bottom, all on one centred axis:
 * headline, sub-headline, the version-graph animation, two buttons. Nothing
 * else. No feature-tag pills, no beta badge, and none of the control hero's
 * "Branch a mix like code…" paragraph.
 *
 * The headline and sub-headline are the control hero's verbatim — same words,
 * same type scale, same accent, same entrance — so the two variants open on an
 * identical statement and the test measures what comes *after* it.
 *
 * The animation is the same branch/merge graph the control hero shows, drawn by
 * `HeroVersionGraphFluid` — the fluid-width variant, which spans the full
 * content column without the stretching a fixed 1080×560 viewBox would suffer
 * at that width. See that component's header for why the control page's
 * `HeroVersionGraph` cannot be used here directly.
 */
function SimpleHero({ signInHref = "/auth" }: { signInHref?: string }) {
  const reduce = useReducedMotion();
  // Same mount gate the control hero uses: motion initial states are skipped on
  // the server render so the prerendered HTML isn't a page of opacity-0 nodes.
  const mounted = useMounted();
  const animate = mounted && !reduce;

  return (
    <section id="top" className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 landing-abs-bleed z-0 tb-grid-bg-landing"
      />
      <div className="relative z-10 px-4 pt-14 pb-14 md:px-8 md:pt-24 md:pb-16">
        {/* Headline and sub-headline are the control hero's, unchanged: same
            markup, same clamp scale, same leading/tracking, same lime accent,
            same left alignment, same entrance transition on the sub-headline
            (the H1 is static there too). Do not re-scale or re-align these —
            they are meant to read identically to `/`. */}
        <h1 className="font-display-tb font-bold leading-[0.82] tracking-[-0.045em]">
          <span className="block text-[clamp(3.2rem,13vw,12rem)] text-lime">
            sonicdesk.
          </span>
          <span className="sr-only">
            {" "}
            — the band workspace with version control, comments on bars, chord detection, and
            rehearsal mode for music bands
          </span>
        </h1>

        <motion.p
          initial={animate ? { opacity: 0, y: 20 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="mt-8 font-display-tb text-[clamp(1.25rem,2.6vw,2.1rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-foreground"
        >
          An ultimate workspace <span className="text-lime">for your music.</span>
        </motion.p>

        {/* Full content width, no max-width. `HeroVersionGraphFluid` — not the
            shared `HeroVersionGraph` — because only it can fill a box wider
            than the artwork's 1080×560 canvas without stretching: it redraws at
            the stage's real pixel size, so the dots stay circular and the curves
            keep their true slope however wide the column gets. Height is capped
            at the design's 560px, so the extra width becomes longer straights
            rather than a bigger drawing. */}
        <motion.div
          initial={animate ? { opacity: 0, y: 24 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="mt-12 w-full md:mt-16"
        >
          <HeroVersionGraphFluid />
        </motion.div>

        <div className="mt-12 flex flex-wrap items-center gap-3">
          <GhostButton variant="lime" href={signInHref}>
            + Start a band
          </GhostButton>
          <GhostButton variant="outline" href="#versioning">
            How it works
          </GhostButton>
        </div>
      </div>

      <Marquee />
    </section>
  );
}

/* ============================================================
 * 02 · Features — variant-only
 * ============================================================ */

/**
 * Same three features, same eyebrows, same headings and the same live demos as
 * the control page — with the description paragraph and the tag pills dropped
 * from each. `FeaturePanel` treats `copy` and `chips` as optional, so the panels
 * are the shared component with two props left off rather than a fork of it.
 */
function SimpleFeatures() {
  return (
    <section id="features" className="landing-section-border px-4 py-20 md:px-8 md:py-28">
      <SectionHeader
        index="02"
        kicker="FEATURES"
        title="NOT A TOOL."
        accent="A WORKSPACE."
        seoNote="Threaded comments on bars, a structure and chord editor, and band chat with a roadmap in one workspace"
      />

      <div className="mt-16 space-y-16 md:space-y-24">
        <FeaturePanel
          side="left"
          eyebrow="02.1 · COMMENTS"
          title="Drop a thought on bar 34."
          demo={<CommentsDemo />}
        />
        <FeaturePanel
          side="right"
          eyebrow="02.2 · STRUCTURE & CHORDS"
          title="Map the song. Know the changes."
          demo={<StructureDemo />}
        />
        <FeaturePanel
          side="left"
          eyebrow="02.3 · SOCIAL"
          title="Your band lives here too."
          demo={<SocialDemo />}
        />
      </div>
    </section>
  );
}

/* ============================================================
 * Page root
 * ============================================================ */

export default function SimpleLandingPage() {
  const { authHref, authLabel } = useLandingAuth();
  const router = useRouter();
  const [standaloneRedirect, setStandaloneRedirect] = useState(false);

  // Identical to the control landing page: an installed PWA launched from the
  // home-screen icon goes to the app shell, not marketing. Gated on display mode
  // and nothing else — never on auth state. See AGENTS.md §4.
  useEffect(() => {
    if (!isRunningAsInstalledPWA()) return;
    setStandaloneRedirect(true);
    router.replace("/dashboard");
  }, [router]);

  if (standaloneRedirect) {
    return <div className="min-h-screen bg-background" data-theme="lime" />;
  }

  return (
    <div className="landing-page min-h-screen" data-theme="lime">
      {/* A/B measurement only — additional to page_view, which is untouched. */}
      <LandingVariantEvent variant="simple" />
      <div className="mx-auto w-full max-w-[1920px]">
        <main className="min-h-screen bg-background text-foreground">
          <TopBar
            authHref={authHref}
            authLabel={authLabel}
            navItems={SIMPLE_NAV_ITEMS}
            isLandingRoute
          />
          <SimpleHero signInHref={authHref} />
          <BranchShowcase showStats={false} />
          <SimpleFeatures />
          <MobileSection showComparisonTable={false} />
          <Philosophy showIntro={false} />
          <ThemingSection showSyncNote={false} />
          <SystemAccordion />
          {/* 07 · Roadmap is deliberately absent on this variant. */}
          <FAQ capitalizeQuestions />
          <CTA signInHref={authHref} />
          <Footer navItems={SIMPLE_NAV_ITEMS} />
        </main>
      </div>
    </div>
  );
}
