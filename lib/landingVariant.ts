/**
 * Landing-page A/B test — variant registry and assignment.
 *
 * Two landing pages exist:
 *   * `control` — `app/page.tsx` → `components/LandingPage.tsx` (the original)
 *   * `simple`  — `app/simple/page.tsx` → `components/landing/SimpleLandingPage.tsx`
 *
 * `middleware.ts` assigns a visitor once, stores the assignment in
 * `LANDING_VARIANT_COOKIE`, and *rewrites* `/` to `SIMPLE_LANDING_PATH` for the
 * `simple` half. Rewrite, not redirect, on purpose: the visitor's URL stays `/`,
 * so inbound links, analytics landing-page dimensions and shared URLs are not
 * split across two addresses by the experiment. `/simple` also stays directly
 * reachable so the variant can be shared and reviewed on its own.
 *
 * This module is imported by middleware and therefore must stay **edge-safe** —
 * no `next/*` imports, no Node built-ins, no React.
 */

export const LANDING_VARIANT_COOKIE = 'landing_variant'

/** One year. The assignment must survive well beyond a single browsing session. */
export const LANDING_VARIANT_MAX_AGE = 60 * 60 * 24 * 365

/** Route the `simple` variant is served from (and rewritten to from `/`). */
export const SIMPLE_LANDING_PATH = '/simple'

export type LandingVariant = 'control' | 'simple'

export function isLandingVariant(value: string | undefined | null): value is LandingVariant {
  return value === 'control' || value === 'simple'
}

/**
 * Fresh 50/50 assignment.
 *
 * `crypto.getRandomValues` rather than `Math.random()`: it is available in the
 * edge runtime, and a byte < 128 is exactly 128 of 256 values, so the split is
 * an exact half rather than one that depends on a float's distribution.
 */
export function rollLandingVariant(): LandingVariant {
  const [byte] = crypto.getRandomValues(new Uint8Array(1))
  return byte < 128 ? 'control' : 'simple'
}
