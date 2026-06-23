import { randomBytes } from 'crypto'
import { supabase } from '@/lib/supabase'

const ADJECTIVES = [
  'blue', 'loud', 'wild', 'raw', 'deep', 'hot', 'cool', 'bright', 'dark', 'fast',
  'slow', 'soft', 'hard', 'live', 'free', 'true', 'gold', 'red', 'neon', 'vintage',
]

const NOUNS = [
  'jam', 'fret', 'riff', 'beat', 'echo', 'tone', 'amp', 'mix', 'groove', 'vibe',
  'chord', 'solo', 'stage', 'track', 'band', 'hook', 'loop', 'wave', 'pulse', 'room',
]

/** Normalize user input to canonical invite-code form (uppercase, single hyphens). */
export function normalizeInviteCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function randomPick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

/** ~36 bits of entropy in the suffix (cryptographically random). */
function randomCode(): string {
  const adj = randomPick(ADJECTIVES).toUpperCase()
  const noun = randomPick(NOUNS).toUpperCase()
  const suffix = randomBytes(5).toString('base64url').slice(0, 8).toUpperCase()
  return `${adj}-${noun}-${suffix}`
}

/** Generate a unique invite code for a band, retrying on collision. */
export async function generateUniqueInviteCode(maxAttempts = 12): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = randomCode()
    const { data } = await supabase
      .from('bands')
      .select('id')
      .eq('invite_code', code)
      .maybeSingle()
    if (!data) return code
  }
  throw new Error('Could not generate a unique invite code')
}

/** Ensure a band has an invite code; returns the active code. */
export async function ensureBandInviteCode(bandId: string): Promise<string> {
  const { data: band } = await supabase
    .from('bands')
    .select('invite_code')
    .eq('id', bandId)
    .single()

  if (band?.invite_code) return band.invite_code

  const code = await generateUniqueInviteCode()
  const { data: updated, error } = await supabase
    .from('bands')
    .update({ invite_code: code })
    .eq('id', bandId)
    .select('invite_code')
    .single()

  if (error) throw error
  return updated.invite_code as string
}
