import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = req.cookies.get('sb-at')?.value
    const userId = token ? getUserIdFromToken(token) : null
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params
    // RLS handles auth — only creator can delete
    const { error } = await supabase.from('comment_replies').delete().eq('id', id).eq('created_by', userId)
    if (error) throw error
    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
