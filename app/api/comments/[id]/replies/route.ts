import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getUserIdFromToken } from '@/lib/supabase/server'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = req.cookies.get('sb-at')?.value
    const userId = token ? getUserIdFromToken(token) : null
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id: commentId } = await params
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
