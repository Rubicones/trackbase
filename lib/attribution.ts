'use client'

/**
 * Pending campaign attribution, parked in localStorage between "landed on the
 * campaign link" and "finished creating an account".
 *
 * Why localStorage and not a cookie: with email OTP the user types the code in
 * the same tab they started in, so a client-side value survives the whole
 * sign-up unaided. A cookie would ride along on every request to every route
 * for no reason, and this value is only ever needed at one moment on the
 * client — the call that establishes the profile.
 *
 * Two rules encoded here:
 *   - **First touch wins.** `storeAttribution` never overwrites. Someone who
 *     arrives via one campaign and then clicks another before signing up stays
 *     credited to the first.
 *   - **Nothing survives a signup.** `clearAttribution` runs as soon as the
 *     values reach a profile, so a second person signing up on the same browser
 *     cannot inherit the first person's tag.
 *
 * Every function is a no-op when localStorage is unavailable (SSR, Safari
 * private mode, storage disabled). Attribution is a nice-to-have; it must never
 * be the reason a sign-up fails.
 */

import type { Cohort } from './campaigns'

const SOURCE_KEY = 'acquisition_source'
const COHORT_KEY = 'cohort'

/** The default for anyone who did not arrive through a campaign link. */
export const DEFAULT_COHORT: Cohort = 'cold'

export interface PendingAttribution {
  acquisitionSource: string
  cohort: Cohort
}

/**
 * Record attribution for a first-time visitor. Returns false if a value was
 * already present (first-touch wins) or if storage is unavailable.
 */
export function storeAttribution(acquisitionSource: string, cohort: Cohort): boolean {
  try {
    if (localStorage.getItem(SOURCE_KEY)) return false
    localStorage.setItem(SOURCE_KEY, acquisitionSource)
    localStorage.setItem(COHORT_KEY, cohort)
    return true
  } catch {
    return false
  }
}

/**
 * Attribution waiting to be written to a profile, or null when the user came
 * in directly. The source is what makes the record meaningful, so a stored
 * cohort without a source is ignored; a source without a cohort falls back to
 * the column default.
 */
export function readAttribution(): PendingAttribution | null {
  try {
    const acquisitionSource = localStorage.getItem(SOURCE_KEY)
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

/** Call immediately after attribution reaches a profile — see the header. */
export function clearAttribution(): void {
  try {
    localStorage.removeItem(SOURCE_KEY)
    localStorage.removeItem(COHORT_KEY)
  } catch {
    /* noop */
  }
}
