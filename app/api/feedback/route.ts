import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuthedClient } from '@/lib/supabase/server'
import { appendFeedbackRow } from '@/lib/googleSheets'

// POST /api/feedback
// Body: { type: 'positive' | 'negative' | 'bug', message: string, pageUrl: string }
//
// Supabase is the source of truth (insert runs under the user's JWT so RLS
// applies). The Google Sheet is a best-effort mirror — a failure there never
// fails the request.

const TYPES = ['positive', 'negative', 'bug'] as const
type FeedbackType = (typeof TYPES)[number]

const MIN_MESSAGE = 10
const MAX_MESSAGE = 2000

function isType(value: unknown): value is FeedbackType {
  return typeof value === 'string' && (TYPES as readonly string[]).includes(value)
}

export async function POST(req: NextRequest) {
  const authed = await getRequestAuthedClient(req)
  if (!authed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { client, user } = authed

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { type, message, pageUrl } = body as Record<string, unknown>

  if (!isType(type)) {
    return NextResponse.json(
      { error: 'type must be one of: positive, negative, bug' },
      { status: 400 },
    )
  }
  if (typeof message !== 'string' || message.trim().length < MIN_MESSAGE) {
    return NextResponse.json(
      { error: `message must be at least ${MIN_MESSAGE} characters` },
      { status: 400 },
    )
  }
  if (message.trim().length > MAX_MESSAGE) {
    return NextResponse.json(
      { error: `message must be at most ${MAX_MESSAGE} characters` },
      { status: 400 },
    )
  }
  if (typeof pageUrl !== 'string' || !pageUrl.trim()) {
    return NextResponse.json({ error: 'pageUrl is required' }, { status: 400 })
  }

  const trimmedMessage = message.trim()

  // 1) Source of truth — surface a failure so the user can retry.
  const { error: insertError } = await client.from('feedback').insert({
    user_id: user.id,
    email: user.email,
    type,
    message: trimmedMessage,
    page_url: pageUrl,
    user_agent: req.headers.get('user-agent'),
  })
  if (insertError) {
    console.error('[feedback] Supabase insert failed:', insertError)
    return NextResponse.json({ error: 'Could not save feedback' }, { status: 500 })
  }

  // 2) Best-effort mirror — never fail the request on a Sheets error.
  try {
    await appendFeedbackRow({
      timestamp: new Date().toISOString(),
      email: user.email ?? '',
      type,
      message: trimmedMessage,
      pageUrl,
    })
  } catch (err) {
    console.error('Failed to mirror feedback to Google Sheets:', err)
    // do not rethrow — Supabase insert already succeeded
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
