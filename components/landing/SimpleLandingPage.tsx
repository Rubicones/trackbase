"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TopBar,
  Hero,
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
  type LandingNavItem,
} from "@/components/LandingPage";
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
 *    the feature demos, the phone mocks), which are imported rather than
 *    reimplemented.
 *  * SHARED WITH A FLAG — the hero and five sections differ from the control
 *    page by exactly one omission or one presentational rule each, so each takes
 *    an optional prop whose default is the control behaviour and stays a single
 *    implementation: `Hero({ showFeaturePills })`,
 *    01 · Versions & Diff, 03 · Mobile, 04 · Philosophy, 05 · Theming and
 *    08 · FAQ. `/` is unaffected by anything here.
 *  * VARIANT-ONLY component, defined below — `SimpleFeatures` differs
 *    structurally, so it is local to this file and cannot reach the control
 *    page.
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
          {/* The control hero verbatim, minus the four feature-tag pills. */}
          <Hero signInHref={authHref} showFeaturePills={false} />
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
