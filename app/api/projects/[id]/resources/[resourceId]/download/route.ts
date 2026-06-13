import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { downloadFromR2 } from '@/lib/r2'
import { getUserIdFromToken } from '@/lib/supabase/server'

// ── GET /api/projects/[id]/resources/[resourceId]/download ────────────────────
// Streams a file resource from R2 to the browser with Content-Disposition:
// attachment so it triggers a native download.

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; resourceId: string }> },
) {
  const { id: projectId, resourceId } = await params

  const token = req.cookies.get('sb-at')?.value
  const userId = token ? getUserIdFromToken(token) : null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify project membership
  const { data: project } = await supabase
    .from('projects')
    .select('id, band_id')
    .eq('id', projectId)
    .single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: member } = await supabase
    .from('band_members')
    .select('id')
    .eq('band_id', project.band_id)
    .eq('user_id', userId)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: resource } = await supabase
    .from('project_resources')
    .select('*')
    .eq('id', resourceId)
    .eq('project_id', projectId)
    .single()

  if (!resource) return NextResponse.json({ error: 'Resource not found' }, { status: 404 })
  if (resource.type !== 'file' || !resource.storage_path) {
    return NextResponse.json({ error: 'Not a downloadable file' }, { status: 400 })
  }

  let fileBuffer: Buffer
  try {
    fileBuffer = await downloadFromR2(resource.storage_path)
  } catch (err) {
    console.error('[resources/download] R2 download failed:', err)
    return NextResponse.json({ error: 'Failed to retrieve file' }, { status: 502 })
  }

  const filename = resource.original_filename ?? 'download'
  const contentType = resource.mime_type ?? 'application/octet-stream'

  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Content-Length': String(fileBuffer.byteLength),
      'Cache-Control': 'private, no-cache',
    },
  })
}
