import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/versions/[id]/tracks
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: versionId } = await params

    const { data: tracks, error } = await supabase
      .from('tracks')
      .select('*')
      .eq('version_id', versionId)
      .order('position', { ascending: true })
    if (error) throw error

    return NextResponse.json({ tracks })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
