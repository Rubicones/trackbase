'use client'

// TEMPORARY — delete this file when OTP login replaces magic links.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { completeAuthFromMagicLinkUrl } from '@/lib/auth/deep-link'
import { AuthInput, AuthButton, AuthHint } from '@/components/auth/AuthPrimitives'

/** Local dev, or set NEXT_PUBLIC_DEV_PASTE_MAGIC_LINK=true on a Vercel preview deploy. */
const SHOW_DEV_PASTE_MAGIC_LINK =
  process.env.NODE_ENV !== 'production' ||
  process.env.NEXT_PUBLIC_DEV_PASTE_MAGIC_LINK === 'true'

/** DEV-ONLY stopgap: paste a magic link URL to sign in without deep links. */
export function DevPasteMagicLink() {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!SHOW_DEV_PASTE_MAGIC_LINK) return null

  async function handleSignIn() {
    setLoading(true)
    setError('')
    try {
      const result = await completeAuthFromMagicLinkUrl(url, router)
      if (!result.ok) {
        setError(result.error)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      data-dev-only="paste-magic-link"
      className="mt-6 border border-dashed border-amber-500/50 bg-amber-500/5 p-4 space-y-3"
    >
      <div>
        <p className="m-0 text-[10px] font-bold uppercase tracking-widest text-amber-500">
          DEV: Paste magic link
        </p>
        <p className="m-0 mt-1 text-[10px] text-muted-foreground">
          Temporary — remove once OTP login ships.
        </p>
      </div>

      <AuthInput
        type="url"
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="Paste magic link URL here..."
        autoComplete="off"
        spellCheck={false}
      />

      {error && <AuthHint error>{error}</AuthHint>}

      <AuthButton
        variant="ghost"
        disabled={loading || !url.trim()}
        onClick={() => void handleSignIn()}
        className="border-amber-500/30"
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </AuthButton>
    </div>
  )
}
