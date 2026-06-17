import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMember } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity'

const VALID_STAGES = ['idea', 'demo', 'arrangement', 'recording', 'mixing', 'mastering', 'released'] as const
type StageId = typeof VALID_STAGES[number]

// PATCH /api/projects/[id]/stage
// Body: { stage: StageId }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params

    const access = await requireBandMember(req, projectId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId, project } = access

    let body: { stage?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const stage = body.stage as StageId
    if (!stage || !VALID_STAGES.includes(stage)) {
      return NextResponse.json(
        { error: `stage must be one of: ${VALID_STAGES.join(', ')}` },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('projects')
      .update({ stage, stage_since: new Date().toISOString() })
      .eq('id', projectId)
      .select('stage, stage_since')
      .single()

    if (error) throw error

    void logActivity({
      bandId: project.band_id,
      userId,
      action: 'meta',
      subject: 'Stage',
      detail: stage,
      projectId,
    })

    return NextResponse.json({ stage: data.stage, stage_since: data.stage_since })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
