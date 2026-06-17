import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json(
    { error: 'Invite links are no longer supported. Use invite codes instead.' },
    { status: 410 },
  )
}

export async function POST() {
  return NextResponse.json(
    { error: 'Invite links are no longer supported. Use invite codes instead.' },
    { status: 410 },
  )
}
