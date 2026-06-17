import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json(
    { valid: false, error: 'Invite links are no longer supported. Ask the band owner for an invite code.' },
    { status: 410 },
  )
}
