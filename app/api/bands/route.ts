import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getRequestUserId } from '@/lib/supabase/server'
import { ensureBandInviteCode } from '@/lib/inviteCode'
import {
  createBandForUser,
  BandLimitReachedError,
  bandLimitReachedBody,
  BAND_LIMIT_REACHED_STATUS,
  isBandLimitUnknown,
} from '@/lib/bandLimit'


// GET /api/bands — return bands the current user is a member of
export async function GET(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('band_members')
    .select(`
      band_id,
      role,
      role_label,
      role_color,
      joined_at,
      bands (
        id,
        name,
        created_at
      )
    `)
    .eq('user_id', userId)
    .order('joined_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Flatten into band objects with member metadata
  const bands = (data ?? []).map((row: Record<string, unknown>) => ({
    ...(row.bands as Record<string, unknown>),
    membership: {
      role: row.role,
      role_label: row.role_label,
      role_color: row.role_color,
      joined_at: row.joined_at,
    },
  }))

  return NextResponse.json({ bands })
}

// POST /api/bands — create a new band and add creator as owner.
//
// Subject to the per-user band limit (`profiles.band_limit`). The acting user
// comes from the session cookie only, and the limit is read from the database
// on every attempt — a user id, owner id or limit in the request body is
// ignored, not honoured. See `lib/bandLimit.ts`.
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // `name` is the ONLY field read from the body, by design.
    const { name } = await req.json()
    if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

    const band = await createBandForUser(userId, name)

    await ensureBandInviteCode(band.id)

    return NextResponse.json({ band }, { status: 201 })
  } catch (err) {
    if (err instanceof BandLimitReachedError) {
      return NextResponse.json(bandLimitReachedBody(err), { status: BAND_LIMIT_REACHED_STATUS })
    }
    if (isBandLimitUnknown(err)) {
      console.error('[bands] could not resolve band_limit for user', userId, err)
      return NextResponse.json({ error: 'Could not verify your band limit' }, { status: 500 })
    }
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
