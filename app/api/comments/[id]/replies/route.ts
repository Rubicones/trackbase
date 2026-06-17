import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMemberForComment } from '@/lib/supabase/server'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: commentId } = await params

    const access = await requireBandMemberForComment(req, commentId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId } = access

    const { content } = await req.json()
    if (!content?.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 })

    const { data: reply, error } = await supabase
      .from('comment_replies')
      .insert({ comment_id: commentId, created_by: userId, content: content.trim() })
      .select()
      .single()
    if (error) throw error

    const { data: profile } = await supabase.from('profiles').select('username').eq('id', userId).maybeSingle()
    return NextResponse.json({ reply: { ...reply, author_username: profile?.username ?? 'unknown' } }, { status: 201 })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
