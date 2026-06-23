import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProjectResource } from '@/lib/types'

type RawResource = {
  context_version_id?: string | null
  context_track_id?: string | null
  [key: string]: unknown
}

export async function enrichResources<T extends RawResource>(
  supabase: SupabaseClient,
  resources: T[],
): Promise<(T & Pick<ProjectResource, 'context_version_name' | 'context_track_name'>)[]> {
  const versionIds = [...new Set(resources.map(r => r.context_version_id).filter(Boolean))] as string[]
  const trackIds = [...new Set(resources.map(r => r.context_track_id).filter(Boolean))] as string[]

  let versionNames: Record<string, string> = {}
  if (versionIds.length > 0) {
    const { data } = await supabase.from('versions').select('id, name').in('id', versionIds)
    if (data) versionNames = Object.fromEntries(data.map(v => [v.id, v.name]))
  }

  let trackNames: Record<string, string> = {}
  if (trackIds.length > 0) {
    const { data } = await supabase.from('tracks').select('id, name, display_name').in('id', trackIds)
    if (data) {
      trackNames = Object.fromEntries(data.map(t => [t.id, t.display_name || t.name]))
    }
  }

  return resources.map(r => ({
    ...r,
    context_version_name: r.context_version_id ? (versionNames[r.context_version_id] ?? null) : null,
    context_track_name: r.context_track_id ? (trackNames[r.context_track_id] ?? null) : null,
  }))
}

export async function validateResourceContext(
  supabase: SupabaseClient,
  projectId: string,
  contextVersionId?: string | null,
  contextTrackId?: string | null,
): Promise<{ context_version_id: string | null; context_track_id: string | null } | { error: string }> {
  let versionId = contextVersionId ?? null
  const trackId = contextTrackId ?? null

  if (trackId) {
    const { data: track } = await supabase
      .from('tracks')
      .select('id, version_id')
      .eq('id', trackId)
      .maybeSingle()

    if (!track) {
      return { error: 'Invalid track for this project' }
    }

    const { data: version } = await supabase
      .from('versions')
      .select('id')
      .eq('id', track.version_id)
      .eq('project_id', projectId)
      .maybeSingle()

    if (!version) {
      return { error: 'Invalid track for this project' }
    }

    versionId = track.version_id
  } else if (versionId) {
    const { data: version } = await supabase
      .from('versions')
      .select('id')
      .eq('id', versionId)
      .eq('project_id', projectId)
      .maybeSingle()
    if (!version) return { error: 'Invalid version for this project' }
  }

  return { context_version_id: versionId, context_track_id: trackId }
}
