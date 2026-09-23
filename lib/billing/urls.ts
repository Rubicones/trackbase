/**
 * Absolute URLs for the round trip through Stripe.
 *
 * Stripe needs somewhere to send the browser back to, and it will only accept
 * an absolute URL. Deriving it from the incoming request (rather than from a
 * constant) is what makes checkout work on a preview deployment and on
 * localhost without a per-environment variable to forget.
 *
 * The canonical production URL still wins when the request arrives on a host
 * we redirect away from anyway (`lib/site-url.ts`), so a user who started on
 * `www.` does not come back to a host that will bounce them.
 */

import type { NextRequest } from 'next/server'
import { PRODUCTION_SITE_URL, REDIRECT_TO_CANONICAL_HOSTS } from '@/lib/site-url'

export function originFor(req: NextRequest): string {
  const host = req.headers.get('host')?.split(':')[0] ?? ''
  if (REDIRECT_TO_CANONICAL_HOSTS.has(host)) return PRODUCTION_SITE_URL
  return new URL(req.url).origin
}

export function billingUrl(req: NextRequest, path: string): string {
  return new URL(path, originFor(req)).toString()
}
