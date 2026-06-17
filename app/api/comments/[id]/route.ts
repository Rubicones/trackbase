import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMemberForComment } from '@/lib/supabase/server'

// DELETE /api/comments/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const access = await requireBandMemberForComment(req, id)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

    const { error } = await supabase.from('track_comments').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error('[comments/delete]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
