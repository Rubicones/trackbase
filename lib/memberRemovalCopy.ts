/**
 * The two sentences said when someone is removed from a space — and nothing
 * else.
 *
 * They live in their own module, with **no imports at all**, because both
 * sides of the removal read them: the owner's confirmation dialog in
 * `app/band/[bandId]/page.tsx` (a client component) and the email in
 * `lib/memberRemoval.ts` (server-only — it reaches Supabase's admin API,
 * `lib/email.ts` and `web-push`). Importing the copy from the server module
 * dragged `web-push` into the browser bundle, and Turbopack failed the build
 * on `Can't resolve 'net'`: a page cannot import a module whose transitive
 * dependencies are Node built-ins, however small the thing it wanted from it.
 *
 * So the rule is the file, not a convention: shared user-facing copy goes
 * where both a client and a server module can reach it without either
 * inheriting the other's dependencies. Do not add an import to this file.
 */

/**
 * What removal actually does — the half people get wrong in both directions.
 *
 * Owners assume removing someone takes their uploads out with them, and hold
 * off; removed members assume the same, and think their work was destroyed.
 * Neither is true: `tracks` belongs to the version, not the uploader.
 */
export const REMOVAL_CONSEQUENCE =
  'They lose access to the space. Everything they uploaded stays — tracks, ' +
  'comments and versions all belong to the space, not to them.'

/** The same fact, addressed to the person it happened to. */
export const REMOVAL_CONSEQUENCE_SELF =
  'Everything you uploaded stays with the space — your tracks, comments and ' +
  'versions belong to it, not to your account, so nothing of yours was deleted.'
