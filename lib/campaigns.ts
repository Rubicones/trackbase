/**
 * Campaign landing links — the attribution registry.
 *
 * A campaign is a dedicated URL (`sonicdesk.studio/<slug>`) that tags whoever
 * arrives through it, so a cohort recruited from one place can be separated
 * from organic signups for the rest of its life in the database.
 *
 * This module is the single source of truth for which slugs exist and what
 * they mean. It is imported by:
 *   - `middleware.ts`            (to keep campaign paths outside the auth gate)
 *   - `components/campaign/CampaignRedirect.tsx` (to resolve the slug it stores)
 *   - `app/<slug>/page.tsx`      (one 3-line file per campaign)
 *
 * It must therefore stay **edge-safe**: pure data and pure functions, no
 * browser or Node APIs. The localStorage side lives in `lib/attribution.ts`.
 *
 * ── Adding a campaign ────────────────────────────────────────────────────────
 *   1. add an entry to CAMPAIGNS below
 *   2. create `app/<slug>/page.tsx` by copying `app/maskeliade/page.tsx` and
 *      changing the slug
 * Nothing else changes — the middleware allowance, the storage write, the
 * profile write and the analytics event are all slug-agnostic.
 */

/** Warm = recruited from a known audience; cold = everyone else (the default). */
export type Cohort = 'warm' | 'cold'

export interface Campaign {
  /** Written to `profiles.acquisition_source`. Keep it short and stable — it
   *  becomes the value analysts group by, so renaming it later splits history. */
  source: string
  /** Written to `profiles.cohort`. */
  cohort: Cohort
}

export const CAMPAIGNS = {
  /** Maskeliade school warm test, July 2026. */
  maskeliade: { source: 'maskeliade', cohort: 'warm' },
} as const satisfies Record<string, Campaign>

export type CampaignSlug = keyof typeof CAMPAIGNS

export const CAMPAIGN_SLUGS = Object.keys(CAMPAIGNS) as CampaignSlug[]

/** The campaign for a slug, or null for anything unrecognised (→ treat as direct/cold). */
export function getCampaign(slug: string): Campaign | null {
  return (CAMPAIGNS as Record<string, Campaign>)[slug] ?? null
}

/** The slug for a campaign path, or null. `/maskeliade/` == `/maskeliade`. */
export function campaignSlugFromPath(pathname: string): CampaignSlug | null {
  const slug = pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  return slug in CAMPAIGNS ? (slug as CampaignSlug) : null
}

/** True for `/maskeliade` (and `/maskeliade/` — a trailing slash is the same link). */
export function isCampaignPath(pathname: string): boolean {
  return campaignSlugFromPath(pathname) !== null
}

/**
 * Cookie that carries the campaign from the landing link to the moment the
 * account is created.
 *
 * localStorage (`lib/attribution.ts`) was the original and only carrier, but it
 * puts the whole mechanism behind "a client effect ran, and nothing cleared
 * storage in between" — which silently yields an unattributed signup with no
 * trace of why. The cookie is stamped by `middleware.ts` before any React code
 * exists, rides the request to `PATCH /api/profile/username` automatically, and
 * is read there **server-side**, so attribution no longer depends on the client
 * at all. localStorage is kept as a secondary source (see the route).
 */
export const CAMPAIGN_COOKIE = 'sd-campaign'

/** 30 days: long enough to survive "clicked the link, signed up next week". */
export const CAMPAIGN_COOKIE_MAX_AGE = 60 * 60 * 24 * 30
