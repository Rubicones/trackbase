import { ENTRY_PATH } from '@/lib/lastBand'

/**
 * Allow only same-origin relative paths for post-login redirects.
 *
 * The fallback is the entry point, not the bands list: with no `next` the user
 * did not ask for anything in particular, so they get taken back where they
 * were. A `next` the middleware stamped on the way in is an explicit
 * destination and is always honoured over it.
 */
export function sanitizeRedirectPath(
  next: string | null | undefined,
  fallback: string = ENTRY_PATH,
): string {
  if (!next) return fallback

  const trimmed = next.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback
  if (trimmed.includes('://') || trimmed.includes('\\')) return fallback

  return trimmed
}
