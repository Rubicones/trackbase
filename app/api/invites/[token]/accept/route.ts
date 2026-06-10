import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getUserIdFromToken } from '@/lib/supabase/server'

// Service-role client — bypasses RLS for invite lookups and member inserts
const adminSupabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

// POST /api/invites/[token]/accept
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  // Auth check uses the user's JWT cookie — not the service client
  const cookieToken = req.cookies.get('sb-at')?.value
  const userId = cookieToken ? getUserIdFromToken(cookieToken) : null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { token } = await params

  // Look up invite via service client (RLS bypassed — invite is readable regardless of who owns it)
  const { data: invite, error: inviteErr } = await adminSupabase
    .from('band_invites')
    .select('id, band_id, uses_count, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (inviteErr || !invite) {
    return NextResponse.json({ error: 'Invalid invite link' }, { status: 404 })
  }
  if (invite.uses_count > 0) {
    return NextResponse.json({ error: 'This invite has already been used' }, { status: 410 })
  }
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This invite has expired' }, { status: 410 })
  }

  // Check if already a member
  const { data: existing } = await adminSupabase
    .from('band_members')
    .select('user_id')
    .eq('band_id', invite.band_id)
    .eq('user_id', userId)
    .maybeSingle()

  if (existing) {
    // Already a member — just redirect to the band
    return NextResponse.json({ band_id: invite.band_id, already_member: true })
  }

  // Add member via service client
  const { error: memberErr } = await adminSupabase
    .from('band_members')
    .insert({ band_id: invite.band_id, user_id: userId, role: 'member' })
  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 })

  // Mark invite as used
  await adminSupabase
    .from('band_invites')
    .update({ uses_count: invite.uses_count + 1 })
    .eq('id', invite.id)

  return NextResponse.json({ band_id: invite.band_id })
}
