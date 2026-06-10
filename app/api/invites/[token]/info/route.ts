import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Service-role client — bypasses RLS so any valid token resolves regardless of who created it
const adminSupabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } }
)

// GET /api/invites/[token]/info — validate an invite token and return band info
// Used by onboarding to show "You'll join: Band Name (N members)" preview
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const { data: invite } = await adminSupabase
    .from('band_invites')
    .select('id, band_id, uses_count, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (!invite) return NextResponse.json({ valid: false, error: 'Invalid or expired invite code' })
  if (invite.uses_count > 0) return NextResponse.json({ valid: false, error: 'This invite has already been used' })
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return NextResponse.json({ valid: false, error: 'This invite has expired' })
  }

  // Fetch band name + member count
  const [bandRes, memberRes] = await Promise.all([
    adminSupabase.from('bands').select('name').eq('id', invite.band_id).single(),
    adminSupabase.from('band_members').select('user_id', { count: 'exact', head: true }).eq('band_id', invite.band_id),
  ])

  if (bandRes.error) return NextResponse.json({ valid: false, error: 'Band not found' })

  return NextResponse.json({
    valid: true,
    band_id: invite.band_id,
    band_name: bandRes.data.name,
    member_count: memberRes.count ?? 0,
  })
}
