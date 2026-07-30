/**
 * Campaign landing links — the attribution registry.
 *
 * A campaign is a dedicated URL (`sonicdesk.studio/<slug>`) that tags whoever
 * arrives through it, so a cohort recruited from one place can be separated
 * from organic signups for the rest of its life in the database.
 *
 * This module is the single source of truth for which slugs exist and what
 * they mean. It is imported by:
 *   - `middleware.ts`                        (intercepts the path, sets the cookie)
 *   - `app/api/profile/username/route.ts`    (resolves the cookie at signup)
 *
 * It must therefore stay **edge-safe**: pure data and pure functions, no
 * browser or Node APIs.
 *
 * ── Adding a campaign ────────────────────────────────────────────────────────
 * Add an entry to CAMPAIGNS below. That is the whole job — there is **no page
 * file**. `/{slug}` is served by middleware, which stamps the cookie and
 * redirects to the landing page before any React renders, so a campaign link
 * has no component, no loading state and no client dependency.
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

/**
 * Cookie that carries the campaign from the landing link to the moment the
 * account is created — the only carrier that matters.
 *
 * localStorage was the original mechanism, written by a client effect on a
 * `/{slug}` page. That put the whole thing behind "React mounted, the effect
 * ran, and nothing cleared storage in between", and when any of that failed the
 * signup was simply unattributed with nothing in the data to say why. The
 * cookie is stamped by `middleware.ts` on the request itself, rides along to
 * `PATCH /api/profile/username` automatically, and is resolved there
 * server-side against the registry — no client involvement at any step.
 */
export const CAMPAIGN_COOKIE = 'sd-campaign'

/** 30 days: long enough to survive "clicked the link, signed up next week". */
export const CAMPAIGN_COOKIE_MAX_AGE = 60 * 60 * 24 * 30
