import { NextResponse } from 'next/server'

/**
 * Legacy token invite links, retired in favour of invite codes.
 *
 * ⚠ This must be a FUNCTION, not a module-level constant. A `Response` body is
 * a single-use stream: `const GONE = NextResponse.json(...)` is consumed by the
 * first request, and every request after it on the same warm instance receives
 * a locked stream — the client gets no body and the request never completes.
 * It looks like a hung server, not like a bug in a two-line file.
 */
function gone() {
  return NextResponse.json(
    { error: 'Invite links are no longer supported. Use invite codes instead.' },
    { status: 410 },
  )
}

export async function GET() { return gone() }
export async function POST() { return gone() }
