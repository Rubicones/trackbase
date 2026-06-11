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

// PATCH /api/tracks/[id]
// Supports: file_hash, storage_path, midi_data updates (for MIDI save flow)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()

    const allowed = ['file_hash', 'storage_path', 'midi_data', 'duration_ms', 'file_size_bytes', 'midi_start_bar', 'start_bar']
    const updates: Record<string, unknown> = {}
    for (const key of allowed) {
      if (key in body) updates[key] = body[key]
    }
    if ('start_bar' in updates) {
      updates.start_bar = Math.max(0, Math.floor(Number(updates.start_bar) || 0))
      updates.midi_start_bar = updates.start_bar
    } else if ('midi_start_bar' in updates) {
      const bar = Math.max(0, Math.floor(Number(updates.midi_start_bar) || 0))
      updates.midi_start_bar = bar
      updates.start_bar = bar
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { data: track, error } = await supabase
      .from('tracks')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error

    return NextResponse.json({ track })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
