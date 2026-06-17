import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { requireBandMember } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity'

type StepInput = { id?: string; name: string }

async function loadRoadmap(projectId: string) {
  const [{ data: project }, { data: steps }] = await Promise.all([
    supabase
      .from('projects')
      .select('roadmap_step_index, stage_since')
      .eq('id', projectId)
      .single(),
    supabase
      .from('project_roadmap_steps')
      .select('id, name, position')
      .eq('project_id', projectId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  const ordered = steps ?? []
  const configured = ordered.length > 0
  let stepIndex = project?.roadmap_step_index ?? null
  if (configured && stepIndex != null) {
    stepIndex = Math.min(Math.max(0, stepIndex), ordered.length)
  } else if (configured) {
    stepIndex = 0
  } else {
    stepIndex = null
  }

  return {
    steps: ordered,
    stepIndex,
    stageSince: project?.stage_since ?? null,
    configured,
  }
}

// GET /api/projects/[id]/roadmap
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params
    const access = await requireBandMember(req, projectId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })

    const roadmap = await loadRoadmap(projectId)
    return NextResponse.json(roadmap)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/projects/[id]/roadmap — replace step list (setup / edit)
// Body: { steps: { id?: string, name: string }[] }
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params
    const access = await requireBandMember(req, projectId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId, project } = access

    let body: { steps?: StepInput[] }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const steps = body.steps
    if (!Array.isArray(steps)) {
      return NextResponse.json({ error: 'steps must be an array' }, { status: 400 })
    }
    if (steps.length > 20) {
      return NextResponse.json({ error: 'A roadmap can have at most 20 steps' }, { status: 400 })
    }

    const cleaned = steps
      .map((s, i) => ({ name: s.name?.trim() ?? '', position: i }))
      .filter(s => s.name.length > 0)

    if (cleaned.some(s => s.name.length > 50)) {
      return NextResponse.json({ error: 'Step names must be 50 characters or fewer' }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from('project_roadmap_steps')
      .select('id')
      .eq('project_id', projectId)

    if (existing?.length) {
      const { error: delErr } = await supabase
        .from('project_roadmap_steps')
        .delete()
        .eq('project_id', projectId)
      if (delErr) throw delErr
    }

    if (cleaned.length > 0) {
      const { error: insErr } = await supabase
        .from('project_roadmap_steps')
        .insert(cleaned.map(s => ({ project_id: projectId, name: s.name, position: s.position })))
      if (insErr) throw insErr
    }

    const { data: current } = await supabase
      .from('projects')
      .select('roadmap_step_index')
      .eq('id', projectId)
      .single()

    let nextIndex: number | null = null
    let stageSince: string | null = null

    if (cleaned.length > 0) {
      const prev = current?.roadmap_step_index
      nextIndex = prev == null ? 0 : Math.min(Math.max(0, prev), cleaned.length)
      stageSince = new Date().toISOString()
      const { error: updErr } = await supabase
        .from('projects')
        .update({ roadmap_step_index: nextIndex, stage_since: stageSince })
        .eq('id', projectId)
      if (updErr) throw updErr
    } else {
      const { error: updErr } = await supabase
        .from('projects')
        .update({ roadmap_step_index: null, stage_since: null })
        .eq('id', projectId)
      if (updErr) throw updErr
    }

    void logActivity({
      bandId: project.band_id,
      userId,
      action: 'meta',
      subject: 'Roadmap',
      detail: cleaned.length ? `${cleaned.length} steps` : 'cleared',
      projectId,
    })

    const roadmap = await loadRoadmap(projectId)
    return NextResponse.json(roadmap)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/projects/[id]/roadmap — move current step
// Body: { stepIndex: number }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params
    const access = await requireBandMember(req, projectId)
    if ('error' in access) return NextResponse.json({ error: access.error }, { status: access.status })
    const { userId, project } = access

    let body: { stepIndex?: number }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    if (typeof body.stepIndex !== 'number' || !Number.isInteger(body.stepIndex) || body.stepIndex < 0) {
      return NextResponse.json({ error: 'stepIndex must be a non-negative integer' }, { status: 400 })
    }

    const { count } = await supabase
      .from('project_roadmap_steps')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)

    if (!count) {
      return NextResponse.json({ error: 'Roadmap is not configured' }, { status: 400 })
    }
    if (body.stepIndex > count) {
      return NextResponse.json({ error: `stepIndex must be at most ${count}` }, { status: 400 })
    }

    const stageSince = new Date().toISOString()
    const { data, error } = await supabase
      .from('projects')
      .update({ roadmap_step_index: body.stepIndex, stage_since: stageSince })
      .eq('id', projectId)
      .select('roadmap_step_index, stage_since')
      .single()

    if (error) throw error

    const { data: steps } = await supabase
      .from('project_roadmap_steps')
      .select('id, name, position')
      .eq('project_id', projectId)
      .order('position', { ascending: true })

    void logActivity({
      bandId: project.band_id,
      userId,
      action: 'meta',
      subject: 'Roadmap step',
      detail: String(body.stepIndex + 1),
      projectId,
    })

    return NextResponse.json({
      steps: steps ?? [],
      stepIndex: data.roadmap_step_index,
      stageSince: data.stage_since,
      configured: true,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
