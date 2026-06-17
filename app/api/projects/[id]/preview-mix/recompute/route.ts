/**
 * POST /api/projects/[id]/preview-mix/recompute
 *
 * Dedicated recompute endpoint for the preview mix. Separated from the read
 * endpoint so it can carry its own generous maxDuration without affecting the
 * latency of normal preview requests.
 *
 * This endpoint is called:
 *   - Directly (in-process via after()) from the GET preview-mix handler for
 *     background stale recomputes.
 *   - Can also be called externally (e.g. admin tooling) provided the caller
 *     is an authenticated band member.
 *
 * NOTE: The ffmpeg binary MUST be included in Next.js output tracing for this
 * route — see next.config.ts outputFileTracingIncludes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireBandMember } from '@/lib/supabase/server'
import { recomputePreviewMix } from '@/lib/previewMix'

// Give ffmpeg enough time to download tracks, mix, and upload the result.
// Vercel Fluid compute / Pro plans support up to 800s; 300s is a safe cap for
// most project sizes.
export const maxDuration = 300

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params

  const access = await requireBandMember(req, projectId)
  if ('error' in access) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  try {
    await recomputePreviewMix(projectId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[preview-mix/recompute] failed:', err)
    return NextResponse.json(
      { error: 'Recompute failed', detail: String(err) },
      { status: 500 }
    )
  }
}
