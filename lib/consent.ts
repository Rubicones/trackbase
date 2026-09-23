/**
 * Cookie consent — the single source of truth for whether the optional
 * trackers (GA4, Meta Pixel, Yandex Metrica) may load.
 *
 * Stored as a first-party cookie, NOT localStorage, so the root layout can
 * read it on the server and never render tracker code into the page when
 * consent is absent or refused. Format: `accepted.<ms>` / `rejected.<ms>` —
 * the choice plus the moment it was made. It is written client-side (the
 * banner), so it cannot be HttpOnly; it carries no identifier.
 *
 * A choice older than CONSENT_MAX_AGE_MS is treated as no choice, so the
 * banner asks again after 12 months even if a browser kept the cookie longer.
 *
 * Shared by server (app/layout.tsx) and client code: no 'use client', and
 * every `document` access is guarded.
 */

export const CONSENT_COOKIE = 'sd_consent'

/** 12 months. The cookie's Max-Age and the timestamp check both use this. */
export const CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000

/** Privacy Policy link used by the banner and the footers (app/privacy, public in middleware.ts). */
export const PRIVACY_POLICY_HREF = '/privacy'

export type ConsentChoice = 'accepted' | 'rejected'
export type ConsentState = { choice: ConsentChoice; ts: number }

/** Parse a raw cookie value. Anything malformed, future-dated or expired → null (= ask). */
export function parseConsent(raw: string | undefined | null, now = Date.now()): ConsentState | null {
  if (!raw) return null
  const m = /^(accepted|rejected)\.(\d{10,16})$/.exec(raw)
  if (!m) return null
  const ts = Number(m[2])
  // One day of clock-skew tolerance for a cookie written by the client's clock.
  if (!Number.isFinite(ts) || ts > now + 24 * 60 * 60 * 1000) return null
  if (now - ts > CONSENT_MAX_AGE_MS) return null
  return { choice: m[1] as ConsentChoice, ts }
}

function serializeConsent({ choice, ts }: ConsentState): string {
  return `${choice}.${ts}`
}

/** Client only. Current consent as stored in the browser right now. */
export function readConsentCookie(): ConsentState | null {
  if (typeof document === 'undefined') return null
  const prefix = `${CONSENT_COOKIE}=`
  const hit = document.cookie.split('; ').find(c => c.startsWith(prefix))
  return parseConsent(hit ? decodeURIComponent(hit.slice(prefix.length)) : null)
}

/** Client only. Persist a choice for 12 months and return what was stored. */
export function writeConsentCookie(choice: ConsentChoice): ConsentState {
  const state: ConsentState = { choice, ts: Date.now() }
  if (typeof document !== 'undefined') {
    const secure = window.location.protocol === 'https:' ? '; Secure' : ''
    document.cookie =
      `${CONSENT_COOKIE}=${serializeConsent(state)}; Path=/; ` +
      `Max-Age=${Math.floor(CONSENT_MAX_AGE_MS / 1000)}; SameSite=Lax${secure}`
  }
  return state
}

/**
 * Client only. The gate every tracker helper checks before sending anything
 * (lib/analytics.ts, lib/meta-pixel.ts, lib/yandex-metrica.ts). Reading the
 * cookie each time — rather than trusting that a script is present — is what
 * stops events the moment consent is withdrawn, even though the scripts
 * already loaded on this page view stay in memory.
 */
export function hasTrackingConsent(): boolean {
  return readConsentCookie()?.choice === 'accepted'
}
