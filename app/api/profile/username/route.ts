import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { supabase } from '@/lib/supabase'
import type { Cohort } from '@/lib/campaigns'

const USERNAME_RE = /^[a-z0-9_]{3,20}$/

/**
 * The username the `handle_new_user` trigger (supabase/migrations/001_auth.sql)
 * writes when a row lands in `auth.users`. It is the fingerprint of a profile
 * nobody has claimed yet — see the attribution note below.
 */
function placeholderUsername(userId: string) {
  return `user_${userId.replace(/-/g, '')}`
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
function parseAttribution(body: {
  acquisitionSource?: unknown
  cohort?: unknown
}): { acquisition_source: string; cohort: Cohort } | null {
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

  const attribution = parseAttribution(body)
  let attributed = false

  if (attribution) {
    // Matches only while the profile still holds its trigger-generated
    // placeholder, i.e. only for an account being established right now.
    const { data: claimed, error: claimErr } = await supabase
      .from('profiles')
      .update({ username, ...attribution })
      .eq('id', userId)
      .eq('username', placeholderUsername(userId))
      .select('id')

    if (claimErr && claimErr.code === '23505') {
      return NextResponse.json({ error: 'Username already taken' }, { status: 409 })
    }
    if (claimErr) {
      // Fall through to the plain update below: attribution is a measurement
      // nicety and must never be the reason someone cannot pick a username.
      console.error('[profile/username] attributed update error:', claimErr)
    } else {
      attributed = (claimed?.length ?? 0) > 0
    }
  }

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
  return NextResponse.json({
    ok: true,
    username,
    attributed,
    ...(attributed && attribution
      ? { source: attribution.acquisition_source, cohort: attribution.cohort }
      : {}),
  })
}
