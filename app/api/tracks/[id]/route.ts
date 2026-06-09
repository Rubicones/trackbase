import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// DELETE /api/tracks/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { error } = await supabase.from('tracks').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ deleted: true })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
