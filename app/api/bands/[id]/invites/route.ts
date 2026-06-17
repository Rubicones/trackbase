import { NextResponse } from 'next/server'

const GONE = NextResponse.json(
  { error: 'Invite links are no longer supported. Use invite codes instead.' },
  { status: 410 },
)

export async function GET() { return GONE }
export async function POST() { return GONE }
