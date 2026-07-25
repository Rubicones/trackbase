/**
 * Email one-time-code (OTP) constants and error helpers.
 *
 * Supabase Auth issues and verifies the code itself (`signInWithOtp` →
 * `verifyOtp`); nothing about the code is stored in our database. See
 * AGENTS.md §4 "Auth & onboarding".
 */

/**
 * Digits in the emailed code. Must match Supabase → Authentication →
 * Sign In / Providers → Email → "Email OTP Length" (Supabase default: 6).
 * If that setting changes, change this constant — the UI renders one box per
 * digit from this value and auto-submits when it is reached.
 */
export const OTP_LENGTH = 6

/**
 * Optimistic resend cooldown, in seconds.
 *
 * Supabase enforces a minimum interval between auth emails per user
 * (project setting: Authentication → Rate Limits → "Minimum interval between
 * emails being sent"; default 60s). That value is not readable from the
 * client, so we count down from this constant and then correct ourselves from
 * the real error if Supabase says we are still too early — see
 * `parseOtpRetryAfterSeconds`.
 */
export const OTP_RESEND_COOLDOWN_SECONDS = 60

/** Digits only, capped at the code length. */
export function sanitizeOtp(raw: string, length: number = OTP_LENGTH): string {
  return raw.replace(/\D/g, '').slice(0, length)
}

/**
 * Supabase reports the email rate limit as
 * "For security purposes, you can only request this after 47 seconds."
 * (status 429, code `over_email_send_rate_limit`). Pull the number out so the
 * cooldown reflects the project's real interval rather than our guess.
 *
 * Returns null when the error is not a rate-limit error we can read a delay
 * from, in which case callers should fall back to
 * `OTP_RESEND_COOLDOWN_SECONDS`.
 */
export function parseOtpRetryAfterSeconds(err: unknown): number | null {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  if (!message) return null

  const match = message.match(/after\s+(\d+)\s*second/i)
  if (!match) return null

  const seconds = Number.parseInt(match[1], 10)
  if (!Number.isFinite(seconds) || seconds <= 0) return null

  // Guard against a pathological value locking the button for minutes.
  return Math.min(seconds, 300)
}

function errorStatus(err: unknown): number | null {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status?: unknown }).status
    if (typeof status === 'number') return status
  }
  return null
}

function errorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return ''
}

export function isOtpRateLimitError(err: unknown): boolean {
  if (errorStatus(err) === 429) return true
  if (errorCode(err) === 'over_email_send_rate_limit') return true
  const message = err instanceof Error ? err.message.toLowerCase() : ''
  return message.includes('only request this after') || message.includes('rate limit')
}

/**
 * Turn a Supabase auth error into copy we are willing to show a user.
 *
 * Supabase deliberately returns the same "Token has expired or is invalid"
 * for a wrong code and an expired code, so we do not try to distinguish them.
 */
export function describeOtpError(err: unknown, context: 'send' | 'verify'): string {
  const raw = err instanceof Error ? err.message : ''
  const message = raw.toLowerCase()

  if (isOtpRateLimitError(err)) {
    const wait = parseOtpRetryAfterSeconds(err)
    return wait
      ? `Too many requests. Try again in ${wait} seconds.`
      : 'Too many requests. Wait a moment before asking for another code.'
  }

  if (context === 'verify') {
    if (message.includes('expired') || message.includes('invalid')) {
      return 'That code is wrong or has expired. Check the latest email, or send a new code.'
    }
    if (message.includes('token') && message.includes('not found')) {
      return 'That code is wrong or has expired. Check the latest email, or send a new code.'
    }
  }

  if (message.includes('email address') && message.includes('invalid')) {
    return 'That email address does not look valid.'
  }
  if (message.includes('signups not allowed') || message.includes('not authorized')) {
    return 'This email is not allowed to sign in. Contact us if that seems wrong.'
  }
  if (message.includes('failed to fetch') || message.includes('network')) {
    return 'Network problem. Check your connection and try again.'
  }

  return raw || 'Something went wrong'
}
