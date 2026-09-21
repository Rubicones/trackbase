/**
 * Dev-only plan tooling.
 *
 * Stripe does not exist yet, so this is how the plan system gets exercised.
 * **Plan changes are deliberately NOT here** — the switcher posts to
 * `/api/me/plan`, the real flow, so selecting a plan in Preferences runs the
 * actual conflict checks, grace period and freezing. A dev switcher that
 * bypassed the logic would be testing nothing.
 *
 * What lives here is the stuff that has no user-facing equivalent yet:
 *   · forcing `grace_until` into the past, so grace expiry and freezing can be
 *     tested without waiting 14 days
 *   · granting and revoking addons by hand, so addon resolution is testable
 *   · setting `band_limit_override`, so the grandfathered-account path is
 *     testable
 *
 * ── Gating ──────────────────────────────────────────────────────────────────
 * `process.env.NODE_ENV === 'development'` — the same test the existing paywall
 * toggle uses (`PAYWALL_TEST_MODE_AVAILABLE`). `next build` sets NODE_ENV to
 * production for every deployment including Vercel previews, so this route
 * 404s everywhere except `next dev`. It returns 404 rather than 403 so its
 * existence is not advertised.
 *
 * Every action still acts on the SESSION user. Even in dev, this cannot be
 * pointed at somebody else's account.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getRequestUserId } from '@/lib/supabase/server'
import { readAddons, resolvePlanState } from '@/lib/entitlements'
import { reconcileOwnerBands, settleAccount } from '@/lib/bandFreeze'
import { DEV_PLAN_TOOLS_AVAILABLE } from '@/lib/devPlanTools'

/**
 * A FUNCTION, not a constant.
 *
 * `const NOT_FOUND = NextResponse.json(...)` at module scope looks like a
 * harmless bit of tidiness and is a hang. A `Response` body is a single-use
 * stream: the first request consumes it, and every request after that on the
 * same warm instance gets a locked stream — no body, no completion, a pending
 * request in the browser until it times out. Build a fresh one per call.
 *
 * (`app/api/bands/[id]/invites/route.ts` and
 * `app/api/invites/[token]/accept/route.ts` had the same shape; both are fixed.)
 */
function notFound() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

const ADDON_TYPES = new Set(['extra_band', 'extra_storage', 'extra_member'])

/** Postgres: null value violates a NOT NULL constraint. */
const PG_NOT_NULL_VIOLATION = '23502'

/**
 * Stage marker for the runtime log.
 *
 * This route awaits several multi-query helpers in sequence, and when one of
 * them stalls the request simply never completes — with nothing in the log to
 * say which. Same reasoning as the `stage=` markers in the WAV export route
 * (AGENTS.md §4): they are the only way to localise a failure after the fact.
 */
function stage(name: string) {
  console.log(`[dev/plan] stage=${name}`)
}

export async function GET(req: NextRequest) {
  if (!DEV_PLAN_TOOLS_AVAILABLE) return notFound()

  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [addons, state] = await Promise.all([readAddons(userId), resolvePlanState(userId)])
  const { data: profile } = await supabase
    .from('profiles')
    .select('band_limit_override')
    .eq('id', userId)
    .maybeSingle()

  return NextResponse.json({
    addons,
    graceUntil: state.graceUntil,
    state: state.state,
    bandLimitOverride: profile?.band_limit_override ?? null,
  })
}

export async function POST(req: NextRequest) {
  if (!DEV_PLAN_TOOLS_AVAILABLE) return notFound()

  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = body.action

  try {
    switch (action) {
      // ── Time travel ───────────────────────────────────────────────────────
      // Push the deadline a day into the past. State is derived from this
      // column, so the account flips to 'enforced' on the very next read and
      // the next band anyone opens gets frozen — exactly the production
      // sequence, minus the two-week wait.
      case 'expire_grace': {
        const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const { error } = await supabase
          .from('profiles')
          .update({ grace_until: past })
          .eq('id', userId)
        if (error) throw error
        return NextResponse.json({ graceUntil: past })
      }

      // NB: this clears the deadline, it does not make the account fit. If the
      // data is still outside the plan, the next read settles it and a fresh
      // 14 days begin — the state is derived from the data, not from whether
      // a dev pressed a button. Use `expire_grace` to test enforcement.
      case 'clear_grace': {
        const { error } = await supabase
          .from('profiles')
          .update({ grace_until: null, grace_keep_band_ids: null })
          .eq('id', userId)
        if (error) throw error
        stage('clear_grace:reconcile')
        await reconcileOwnerBands(userId, false)
        stage('clear_grace:done')
        return NextResponse.json({ graceUntil: null })
      }

      // ── Addons ────────────────────────────────────────────────────────────
      case 'grant_addon': {
        const type = body.addon_type
        if (typeof type !== 'string' || !ADDON_TYPES.has(type)) {
          return NextResponse.json({ error: 'addon_type must be extra_band, extra_storage or extra_member' }, { status: 400 })
        }
        const quantity = typeof body.quantity === 'number' ? Math.max(1, Math.floor(body.quantity)) : 1
        const bandId = typeof body.band_id === 'string' && body.band_id ? body.band_id : null

        // extra_storage and extra_member are band-scoped by definition; without
        // a band they would resolve to nothing and look like a silent failure.
        if ((type === 'extra_storage' || type === 'extra_member') && !bandId) {
          return NextResponse.json({ error: `${type} requires a band_id` }, { status: 400 })
        }

        const { data, error } = await supabase
          .from('plan_addons')
          .insert({ user_id: userId, addon_type: type, band_id: bandId, quantity })
          .select()
          .single()
        if (error) throw error
        // Capacity just changed, so the account may no longer be over its
        // limit. Reconciling here releases frozen bands and clears a stale
        // grace deadline immediately, rather than leaving the banner up until
        // something else happens to touch a band. The enforce flag is derived
        // rather than assumed: granting one addon does not necessarily put an
        // account back inside every ceiling it was outside of.
        await settleAccount(userId)
        return NextResponse.json({ addon: data }, { status: 201 })
      }

      case 'revoke_addon': {
        const id = body.id
        if (typeof id !== 'string') {
          return NextResponse.json({ error: 'id is required' }, { status: 400 })
        }
        // Scoped to the session user: a dev tool is still not a way to edit
        // someone else's entitlements.
        const { error } = await supabase
          .from('plan_addons')
          .delete()
          .eq('id', id)
          .eq('user_id', userId)
        if (error) throw error
        await settleAccount(userId)
        return NextResponse.json({ ok: true })
      }

      case 'clear_addons': {
        const { error } = await supabase.from('plan_addons').delete().eq('user_id', userId)
        if (error) throw error
        // Capacity dropped — anything now over the limit freezes here rather
        // than on the next touch.
        await settleAccount(userId)
        return NextResponse.json({ ok: true })
      }

      // ── The grandfathered-account override ────────────────────────────────
      case 'set_band_limit_override': {
        const value = body.value
        const next =
          value === null ? null
            : typeof value === 'number' && value >= 0 ? Math.floor(value)
              : undefined
        if (next === undefined) {
          return NextResponse.json({ error: 'value must be a non-negative number or null' }, { status: 400 })
        }
        stage('set_band_limit_override:update')
        const { error } = await supabase
          .from('profiles')
          .update({ band_limit_override: next })
          .eq('id', userId)

        // `band_limit_override` is nullable by construction, so clearing it is
        // an ordinary update. This route must never write `profiles.band_limit`
        // — that column belongs to the pre-plans code path and is what a
        // rollback to `main` depends on.
        if (error?.code === PG_NOT_NULL_VIOLATION) {
          return NextResponse.json(
            {
              error:
                'profiles.band_limit_override is NOT NULL in this database, which it must not be. ' +
                'Re-run 20260806_subscription_plans.sql.',
            },
            { status: 409 },
          )
        }
        if (error) throw error

        // The override REPLACES the plan's allowance, so setting it is the one
        // dev action that can shrink an account's capacity in a single step.
        // Settling derives the state from the data afterwards — including
        // starting a grace period when the account no longer fits.
        stage('set_band_limit_override:settle')
        await settleAccount(userId)
        stage('set_band_limit_override:done')
        return NextResponse.json({ bandLimitOverride: next })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (err) {
    console.error('[dev/plan]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
