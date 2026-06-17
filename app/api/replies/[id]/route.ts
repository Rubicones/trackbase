import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMemberForReply } from '@/lib/supabase/server'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    // Verify band membership and that the requester is the author
    const access = await requireBandMemberForReply(req, id)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId, reply } = access

    if (reply.created_by !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await supabase.from('comment_replies').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
