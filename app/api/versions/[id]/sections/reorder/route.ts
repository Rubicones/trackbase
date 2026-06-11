import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// POST /api/versions/[id]/sections/reorder
// Body: { sections: [{ id, position }] }
export async function POST(
  req: NextRequest,
  _ctx: { params: Promise<{ id: string }> }
) {
  try {
    const body = await req.json()
    const { sections } = body as { sections: { id: string; position: number }[] }

    await Promise.all(
      sections.map(({ id, position }) =>
        supabase.from('sections').update({ position }).eq('id', id)
      )
    )
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
