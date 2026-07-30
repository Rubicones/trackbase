import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { supabase } from '@/lib/supabase'
import { getCampaign, CAMPAIGN_COOKIE, type Cohort } from '@/lib/campaigns'

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

/**
 * ⚠ There is no placeholder username. The live `handle_new_user` trigger is
 * `insert into public.profiles (id) values (new.id)` — it does not populate
 * `username`, so a fresh profile carries **NULL** there.
 *
 * `supabase/migrations/001_auth.sql` shows a `coalesce(..., 'user_' ||
 * replace(new.id::text,'-',''))` version that is NOT what is deployed;
 * migrations here are applied by hand and that file is not a complete history.
 * Attribution used to be guarded with `.eq('username', <that placeholder>)`,
 * which therefore matched zero rows on every signup — no error, no retry, just
 * a permanently cold profile. Do not reintroduce a guard that depends on the
 * shape of a value the database writes.
 */

/**
 * Whether this request is the first time this account has ever set a username —
 * i.e. the moment a placeholder profile becomes a real account, and the one
 * moment attribution may be written.
 *
 * `user_metadata.username` is the right signal because **this route is the only
 * writer of it** (see the bottom of the handler) and `middleware.ts` forces the
 * onboarding flow until it exists. So "no metadata username" means "has never
 * completed the username step", for every account, regardless of what the
 * database trigger chose to seed `profiles.username` with. Any pre-existing
 * user necessarily has it set and can therefore never be re-tagged, which is
 * the property that matters — an organic user must not be converted to a
 * campaign cohort by clicking a campaign link years later.
 */
async function isFirstUsername(userId: string): Promise<boolean> {
  const { data, error } = await supabase.auth.admin.getUserById(userId)
  if (error || !data.user) return false
  return !data.user.user_metadata?.username
}

/**
 * ── Campaign attribution ─────────────────────────────────────────────────────
 * `acquisition_source` / `cohort` record where a user came from, once, forever.
 * They are set here and nowhere else, and only for an account being created
 * right now. An existing profile is never re-tagged — not on a later login, and
 * not if the user clicks a campaign link years after signing up.
 *
 * There is no app code that INSERTs a profile: the row is created by a database
 * trigger the moment Supabase Auth creates the user, carrying a placeholder
 * username. So "the profile row is being created right now" has to be expressed
 * as "the profile still carries its placeholder username" — this request, the
 * first-ever username set, is the moment the profile becomes a real account.
 *
 * That condition is enforced **inside the UPDATE** (`.eq('username',
 * placeholder)`) rather than by reading the row first and deciding in JS. Two
 * reasons: a read-then-write leaves a window where two in-flight requests could
 * both conclude "brand new", and more importantly the guard belongs to the
 * write it protects — a future edit cannot accidentally separate them. If the
 * predicate does not match, Postgres updates zero rows and we fall through to a
 * plain username update that cannot touch the attribution columns.
 *
 * Note that the condition is deliberately NOT "does this user have a source
 * yet?". Under that test, an existing organic user (`acquisition_source` null,
 * which is the normal state for most of the table) would be tagged the first
 * time they opened a campaign link — silently converting cold users to warm and
 * corrupting the comparison the cohorts exist to make.
 *
 * The chosen username can never collide with the placeholder: `user_` plus 32
 * hex characters is 37 long, and USERNAME_RE caps input at 20.
 */
type Attribution = { acquisition_source: string; cohort: Cohort }

/**
 * Two carriers, checked in order of trustworthiness:
 *
 *  1. **The `sd-campaign` cookie**, stamped by `middleware.ts` when the visitor
 *     hit the campaign link. Server-set and server-read, so it works even if
 *     the client never ran the storing effect or storage was unavailable — the
 *     failure mode that produced unattributed signups. The slug is resolved
 *     against the registry, so the values written are ours, not the client's.
 *  2. **The request body**, populated from localStorage by the onboarding page.
 *     Retained so a visitor who arrived before this cookie existed (or who is
 *     mid-signup across the deploy) is still attributed.
 */
function resolveAttribution(
  cookieSlug: string | undefined,
  body: { acquisitionSource?: unknown; cohort?: unknown },
): Attribution | null {
  const campaign = cookieSlug ? getCampaign(cookieSlug) : null
  if (campaign) {
    return { acquisition_source: campaign.source, cohort: campaign.cohort }
  }

  const source = typeof body.acquisitionSource === 'string' ? body.acquisitionSource.trim() : ''
  // Bounded because it arrives from client-controlled localStorage. Anything
  // outside the shape a campaign slug takes is discarded rather than stored.
  if (!source || !/^[a-z0-9_-]{1,40}$/.test(source)) return null
  return {
    acquisition_source: source,
    // Unrecognised cohorts fall back to the column default rather than being
    // rejected — a bad cohort should not cost us the source.
    cohort: body.cohort === 'warm' ? 'warm' : 'cold',
  }
}

// PATCH /api/profile/username — set username during onboarding
export async function PATCH(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in. Please sign in again.' }, { status: 401 })
  }

  let body: { username?: string; acquisitionSource?: unknown; cohort?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const username = body.username?.trim().toLowerCase() ?? ''
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json(
      { error: 'Username must be 3–20 characters — letters, numbers, underscores only' },
      { status: 400 },
    )
  }

  const { data: taken } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .neq('id', userId)
    .maybeSingle()

  if (taken) {
    return NextResponse.json({ error: 'Username already taken' }, { status: 409 })
  }

  const cookieSlug = req.cookies.get(CAMPAIGN_COOKIE)?.value
  const attribution = resolveAttribution(cookieSlug, body)
  let attributed = false

  // Attribution is write-once and unobservable after the fact: if it doesn't
  // land there is no retry and no error, just a permanently cold profile. So
  // every attempt logs which inputs it had and what the guarded UPDATE did.
  // Check Vercel → Runtime Logs, filter `[profile/username]`.
  const trace: Record<string, unknown> = {
    cookie: cookieSlug ?? null,
    bodySource: typeof body.acquisitionSource === 'string' ? body.acquisitionSource : null,
    resolved: attribution?.acquisition_source ?? null,
  }

  if (attribution) {
    // Read-then-write, deliberately. The previous version folded the test into
    // the UPDATE to close the gap between check and write — nice in theory,
    // but it made correctness depend on reproducing a database trigger's
    // output in TypeScript, and that is what broke (see the note at the top).
    // A first-username check cannot meaningfully race anyway: both requests
    // would be the same user setting their first username, and the second one
    // finds the metadata already written.
    const firstUsername = await isFirstUsername(userId)
    trace.firstUsername = firstUsername

    // upsert, not update: if the `handle_new_user` trigger never ran (or does
    // not exist in this environment) there is no row to update and the write
    // would silently match zero rows — the same invisible failure as before,
    // one layer down. Safe because it only runs for a first-ever username.
    const { data: claimed, error: claimErr } = firstUsername
      ? await supabase
          .from('profiles')
          .upsert({ id: userId, username, ...attribution }, { onConflict: 'id' })
          .select('id')
      : { data: null, error: null }

    if (claimErr && claimErr.code === '23505') {
      return NextResponse.json({ error: 'Username already taken' }, { status: 409 })
    }
    if (claimErr) {
      // Fall through to the plain update below: attribution is a measurement
      // nicety and must never be the reason someone cannot pick a username.
      console.error('[profile/username] attributed update error:', claimErr)
    } else {
      attributed = (claimed?.length ?? 0) > 0
      trace.rowsMatched = claimed?.length ?? 0
    }
  }

  // The row's actual username is the one fact the guard turns on and the one
  // thing the UPDATE can't report back, so read it when the claim missed.
  if (!attributed) {
    const { data: row } = await supabase
      .from('profiles')
      .select('username, acquisition_source, cohort')
      .eq('id', userId)
      .maybeSingle()
    trace.actualRow = row ?? 'NO PROFILE ROW'
  }
  console.log('[profile/username] attribution', JSON.stringify({ ...trace, attributed }))

  // Runs when there was no attribution to write, or when the profile turned out
  // to be an existing one (zero rows matched above) and so must keep whatever
  // acquisition_source/cohort it already has.
  if (!attributed) {
    const { error: profileErr } = await supabase
      .from('profiles')
      .update({ username })
      .eq('id', userId)

    if (profileErr) {
      if (profileErr.code === '23505') {
        return NextResponse.json({ error: 'Username already taken' }, { status: 409 })
      }
      console.error('[profile/username] profile update error:', profileErr)
      return NextResponse.json({ error: 'Could not save username' }, { status: 500 })
    }
  }

  const { error: metaErr } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: { username },
  })

  if (metaErr) {
    console.error('[profile/username] metadata update error:', metaErr)
    return NextResponse.json({ error: 'Could not save username' }, { status: 500 })
  }

  // `attributed` is the client's cue to fire the analytics event and drop the
  // stored values. It is true only when this request actually wrote them, so a
  // retry or a returning user cannot double-count a signup.
  const res = NextResponse.json({
    ok: true,
    username,
    attributed,
    ...(attributed && attribution
      ? { source: attribution.acquisition_source, cohort: attribution.cohort }
      : {}),
  })

  // Burn the cookie once this profile is settled — whether we attributed it or
  // it turned out to be an existing account. Either way the campaign has had
  // its one chance, and leaving it would let the next person to sign up in this
  // browser inherit the tag (the same rule `clearAttribution` enforces for
  // localStorage).
  if (req.cookies.get(CAMPAIGN_COOKIE)) {
    res.cookies.set(CAMPAIGN_COOKIE, '', { path: '/', maxAge: 0 })
  }

  return res
}
