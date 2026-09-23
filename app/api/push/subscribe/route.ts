import { NextRequest, NextResponse } from 'next/server'
import { getRequestUserId } from '@/lib/supabase/server'
import { supabase } from '@/lib/supabase'
import { serverErrorResponse } from '@/lib/apiErrors'

// POST /api/push/subscribe — save or update a push subscription
export async function POST(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { endpoint?: string; p256dh?: string; auth?: string; userAgent?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { endpoint, p256dh, auth, userAgent } = body
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'endpoint, p256dh, and auth are required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: userId,
        endpoint,
        p256dh,
        auth,
        user_agent: userAgent ?? null,
      },
      { onConflict: 'user_id,endpoint' },
    )

  if (error) {
    return serverErrorResponse('push/subscribe', error, 'Could not save your notification subscription')
  }

  return NextResponse.json({ ok: true })
}

// DELETE /api/push/subscribe — remove a push subscription
export async function DELETE(req: NextRequest) {
  const userId = await getRequestUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { endpoint?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.endpoint) {
    return NextResponse.json({ error: 'endpoint is required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', body.endpoint)

  if (error) {
    return serverErrorResponse('push/subscribe', error, 'Could not remove your notification subscription')
  }

  return NextResponse.json({ ok: true })
}
