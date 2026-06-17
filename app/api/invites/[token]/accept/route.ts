import { NextResponse } from 'next/server'

const GONE = NextResponse.json(
  { error: 'Invite links are no longer supported. Ask the band owner for an invite code.' },
  { status: 410 },
)

export async function GET() { return GONE }
export async function POST() { return GONE }
