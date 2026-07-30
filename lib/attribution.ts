'use client'

/**
 * Client-side view of the pending campaign attribution.
 *
 * **The authoritative carrier is the `sd-campaign` cookie**, set by
 * `middleware.ts` when the visitor hits a campaign link and read server-side by
 * `PATCH /api/profile/username`. Attribution does not depend on anything in
 * this file — the profile is tagged correctly even if no client code here ever
 * runs.
 *
 * This module exists so the *browser* can also see which campaign a visitor
 * arrived from (analytics, conditional copy, debugging). It reads the cookie
 * first and falls back to the legacy localStorage pair, which is still present
 * for anyone who clicked a campaign link before the cookie shipped.
 *
 * Why not sessionStorage: it is emptied when the tab closes, so a visitor who
 * clicks the link, closes the tab and signs up an hour later would lose the
 * campaign — the precise failure this mechanism exists to prevent. The cookie
 * lasts 30 days and survives tab, window and browser restarts.
 *
 * Every function is a no-op when storage is unavailable (SSR, Safari private
 * mode, storage disabled). Attribution is a nice-to-have; it must never be the
 * reason a sign-up fails.
 */

import { getCampaign, CAMPAIGN_COOKIE, type Cohort } from './campaigns'

const SOURCE_KEY = 'acquisition_source'
const COHORT_KEY = 'cohort'

/** The default for anyone who did not arrive through a campaign link. */
export const DEFAULT_COHORT: Cohort = 'cold'

export interface PendingAttribution {
  acquisitionSource: string
  cohort: Cohort
}

function readCampaignCookie(): PendingAttribution | null {
  try {
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${CAMPAIGN_COOKIE}=([^;]*)`),
    )
    if (!match) return null
    const campaign = getCampaign(decodeURIComponent(match[1]))
    if (!campaign) return null
    return { acquisitionSource: campaign.source, cohort: campaign.cohort }
  } catch {
    return null
  }
}

function readLegacyStorage(): PendingAttribution | null {
  try {
    const acquisitionSource = localStorage.getItem(SOURCE_KEY)
    // The source is what makes the record meaningful, so a stored cohort
    // without a source is ignored; a source without a cohort falls back to the
    // column default.
    if (!acquisitionSource) return null
    const stored = localStorage.getItem(COHORT_KEY)
    return {
      acquisitionSource,
      cohort: stored === 'warm' || stored === 'cold' ? stored : DEFAULT_COHORT,
    }
  } catch {
    return null
  }
}

/**
 * The campaign this visitor arrived from, or null for a direct visit. Cookie
 * first (current mechanism), legacy localStorage second.
 */
export function readAttribution(): PendingAttribution | null {
  return readCampaignCookie() ?? readLegacyStorage()
}

/**
 * Drop the legacy localStorage pair once attribution has reached a profile, so
 * a second person signing up in this browser cannot inherit the first person's
 * campaign. The cookie half of that cleanup is done server-side by the route
 * that claims it, since only the server knows the claim succeeded.
 */
export function clearAttribution(): void {
  try {
    localStorage.removeItem(SOURCE_KEY)
    localStorage.removeItem(COHORT_KEY)
  } catch {
    /* noop */
  }
}
