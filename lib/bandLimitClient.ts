/**
 * Client-side helpers for the band ownership limit.
 *
 * These are presentation only. The client displays the limit and the count; it
 * never asserts them — neither value is ever sent back to the server as part of
 * a create request. Enforcement lives in `lib/bandLimit.ts` and in the database
 * trigger behind it.
 */

import { trackEvent } from '@/lib/analytics'

export interface BandLimitInfo {
  limit: number
  current: number
  atLimit: boolean
}

/** The one place the limit is worded, so every entry point says the same thing. */
export function bandLimitMessage(limit: number): string {
  return `You've reached the limit of ${limit} band${limit === 1 ? '' : 's'}.`
}

/** Follow-up line: what the user can actually do about it. */
export const BAND_LIMIT_HINT =
  'Delete one you no longer need, or join a bandmate’s space — bands you join don’t count.'

// Once per page load per limit value: hitting the wall is one event, not one
// per render or per retry.
const reported = new Set<number>()

export function reportBandLimitReached(limit: number): void {
  if (reported.has(limit)) return
  reported.add(limit)
  // No user id, email or band names — same as every other event in the app.
  trackEvent('band_limit_reached', { limit })
}

/**
 * Recognise the structured refusal from a band-create endpoint.
 *
 * Accepts both shapes: the plan system's uniform
 * `{ error: 'limit_reached', limit_type: 'bands', … }`, and the older
 * `{ error: 'band_limit_reached', … }` that predates it. The legacy branch is
 * kept because a browser tab open across the deploy will still be talking to
 * whichever version answers — dropping it would show that user a raw error
 * instead of the limit message, for no gain.
 */
export function parseBandLimitError(data: unknown): BandLimitInfo | null {
  if (!data || typeof data !== 'object') return null
  const body = data as {
    error?: unknown
    limit_type?: unknown
    limit?: unknown
    current?: unknown
  }

  const isBandsLimit =
    (body.error === 'limit_reached' && body.limit_type === 'bands') ||
    body.error === 'band_limit_reached'
  if (!isBandsLimit) return null

  const limit = typeof body.limit === 'number' ? body.limit : 0
  const current = typeof body.current === 'number' ? body.current : limit
  return { limit, current, atLimit: true }
}
