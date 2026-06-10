import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

function getUserId(req: NextRequest): string | null {
  const token = req.cookies.get('sb-at')?.value
  return token ? getUserIdFromToken(token) : null
}

// GET /api/bands — return bands the current user is a member of
export async function GET(req: NextRequest) {
  const userId = getUserId(req)
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

// POST /api/bands — create a new band and add creator as owner
export async function POST(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { name } = await req.json()
    if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

    const { data: band, error: bandErr } = await supabase
      .from('bands')
      .insert({ name: name.trim() })
      .select()
      .single()
    if (bandErr) throw bandErr

    // Add creator as owner
    const { error: memberErr } = await supabase
      .from('band_members')
      .insert({ band_id: band.id, user_id: userId, role: 'owner' })
    if (memberErr) throw memberErr

    return NextResponse.json({ band }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
