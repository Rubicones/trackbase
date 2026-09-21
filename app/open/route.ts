/**
 * `/open` — "take me back into the app".
 *
 * Resolves the default entry point for a signed-in user: the band this device
 * last opened, or the bands list when there isn't one. It exists as a route of
 * its own so that the rule lives in exactly one place — post-login, the
 * installed PWA's `start_url` and the landing page's standalone redirect all
 * point here rather than each re-deriving it.
 *
 * Membership is re-checked here, every time. The cookie is a hint written on a
 * previous visit; between then and now the band may have been deleted, or the
 * user removed from it, and following a stale hint would land them on a 403
 * instead of somewhere useful. A hint that no longer holds is cleared on the
 * way out, so the next launch does not pay for the check again.
 *
 * Auth is the middleware's job: `/open` is not public, so an unauthenticated
 * request is redirected to `/auth?next=/open` before it ever reaches this
 * handler and comes back here once the session exists.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getRequestUserId } from '@/lib/supabase/server'
import {
  BANDS_LIST_PATH,
  entryDestination,
  forgetLastBand,
  readLastBandId,
} from '@/lib/lastBand'

export async function GET(req: NextRequest) {
  const toList = () => NextResponse.redirect(new URL(BANDS_LIST_PATH, req.url))

  const bandId = readLastBandId(req)
  if (!bandId) return toList()

  const userId = await getRequestUserId(req)
  if (!userId) return toList()

  const { data: membership } = await supabase
    .from('band_members')
    .select('band_id')
    .eq('band_id', bandId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!membership) {
    const res = toList()
    forgetLastBand(res)
    return res
  }

  return NextResponse.redirect(new URL(entryDestination(bandId), req.url))
}
