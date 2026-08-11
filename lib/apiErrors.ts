/**
 * Server-error responses that say enough and no more.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * A 500 tells the user that *we* failed. It must not tell them *how*. Postgres
 * error text is written for the person who wrote the query: it names tables,
 * columns, constraints and check names, and — in this codebase specifically —
 * the band-limit routines attach `DETAIL: limit=<n> current=<n>`, which hands a
 * caller the exact shape of an enforcement rule they are trying to get around.
 * `String(err)` from an ffmpeg or R2 path is worse still: filesystem paths,
 * bucket keys, occasionally a stack frame.
 *
 * So the free text goes to the log, where it is actually useful, and the client
 * gets a sentence a human can act on.
 *
 * ── What this does NOT touch ────────────────────────────────────────────────
 * The structured refusals are a contract, not an error string:
 *
 *   { error: 'limit_reached', limit_type, limit, current, message }
 *   { error: 'band_frozen',   band_id, reason }
 *
 * `lib/planCopy.ts` (`parseLimitRefusal` / `apiErrorMessage`) parses those by
 * shape, and the UI names the specific ceiling from them. They are produced by
 * `limitRefusalResponse()` and must keep flowing untouched — this helper is for
 * the "something broke" path only. Never route a refusal through it.
 *
 * ── Why the message is a sentence, not a code ───────────────────────────────
 * Most call sites in the app render `data.error` directly (`data.error ??
 * 'Failed'`), so whatever goes in this field is read by a person. A machine
 * token like 'internal_error' would be shown verbatim. Write English.
 */

import { NextResponse } from 'next/server'

/**
 * Log the real failure, return a safe one.
 *
 * @param scope   log prefix, matching the existing `[route/name]` convention —
 *                this is what makes the entry findable in Vercel Runtime Logs.
 * @param err     the original error. Logged in full, never serialised to the
 *                response.
 * @param message what the user sees. A complete sentence.
 * @param status  defaults to 500.
 * @param extra   additional NON-SENSITIVE fields to merge into the body, e.g.
 *                the export route's `stage` marker. Nothing derived from an
 *                error object belongs here.
 */
export function serverErrorResponse(
  scope: string,
  err: unknown,
  message: string,
  status = 500,
  extra?: Record<string, unknown>,
): NextResponse {
  console.error(`[${scope}]`, err)
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status })
}
