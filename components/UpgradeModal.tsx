'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { getSupabaseClient } from '@/lib/supabase/client'
import { trackEvent } from '@/lib/analytics'
import { TbModal } from '@/components/design/TbModal'
import { TbButton } from '@/components/design/TbButton'

type Plan = 'band' | 'studio'
export type UpgradeSource = 'avatar_menu' | 'storage_bar' | 'storage_limit'

const BAND_FEATURES = [
  'Unlimited members',
  'Unlimited projects',
  '10 GB storage',
  'Priority audio processing',
  'Stem separation (10/mo)',
  'AI track generation (5/mo)',
]

const STUDIO_FEATURES = [
  'Multiple bands under one account',
  '50 GB storage',
  'Stem separation (unlimited)',
  'AI track generation (unlimited)',
]

const FREE_LIMITS = ['1 band', '3 members', '3 projects', '500 MB storage']

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden className="shrink-0 mt-0.5">
      <path d="M2 5.5l2.5 2.5 4.5-4.5" stroke="var(--ember)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function UpgradeModal({
  source,
  onClose,
}: {
  source: UpgradeSource
  onClose: () => void
}) {
  const { user } = useAuth()
  const [step, setStep] = useState<'select' | 'confirm'>('select')
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSelect(plan: Plan) {
    if (busy) return
    setBusy(true)

    // Fire GA4 event — no PII
    trackEvent('upgrade_intent', { plan, source })

    // Insert intent into DB — email stays server-side only
    try {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('subscription_intents').insert({
        user_id: user!.id,
        plan,
        email: user!.email ?? null,
      })
      if (error) console.error('[UpgradeModal] Intent insert error:', error)
    } catch (err) {
      console.error('[UpgradeModal] Intent insert failed:', err)
    }

    setSelectedPlan(plan)
    setBusy(false)
    setStep('confirm')
  }

  if (step === 'confirm' && selectedPlan) {
    return (
      <TbModal onClose={onClose}>
        <div className="flex flex-col items-center text-center gap-4">
          <div className="size-14 border border-ember/40 bg-ember-soft grid place-items-center text-2xl">
            🎉
          </div>
          <div>
            <p className="font-display text-xl uppercase tracking-tight text-foreground m-0">
              You&apos;re on the list!
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed mt-3 m-0 max-w-sm">
              Thanks for wanting to get the most out of Trackbase.
              We&apos;ll reach out to{' '}
              <span className="text-foreground">{user?.email}</span>{' '}
              when full launch happens — you&apos;ll be among the first to know,
              and early supporters get priority access.
            </p>
          </div>
          <TbButton variant="primary" className="mt-1" onClick={onClose}>
            Back to Trackbase
          </TbButton>
        </div>
      </TbModal>
    )
  }

  return (
    <TbModal onClose={onClose}>
      {/* Header */}
      <div className="mb-5">
        <p className="font-display text-xl uppercase tracking-tight text-foreground m-0">
          Choose your plan
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed mt-1.5 m-0">
          Trackbase is free during beta. Subscribe now to lock in early pricing when we launch.
        </p>
      </div>

      {/* Plan cards */}
      <div className="space-y-3 mb-4">

        {/* Band */}
        <div className="border border-border bg-surface p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5 m-0">
                For active bands
              </p>
              <p className="font-display text-lg uppercase tracking-tight text-foreground m-0">
                Band
              </p>
            </div>
            <div className="text-right shrink-0">
              <span className="text-xl font-bold text-ember tabular-nums">$12</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest">/mo</span>
            </div>
          </div>
          <ul className="space-y-1.5 mb-3">
            {BAND_FEATURES.map(f => (
              <li key={f} className="flex items-start gap-2 text-[11px] text-muted-foreground leading-snug">
                <CheckIcon />
                {f}
              </li>
            ))}
          </ul>
          <TbButton
            variant="ghost"
            className="w-full justify-center"
            disabled={busy}
            onClick={() => handleSelect('band')}
          >
            {busy ? 'Saving…' : 'Select Band'}
          </TbButton>
        </div>

        {/* Studio */}
        <div className="border border-ember bg-surface p-4 relative">
          <div className="absolute top-0 right-0 bg-ember text-white text-[8px] font-bold uppercase tracking-widest px-2 py-1">
            Most popular
          </div>
          <div className="flex items-start justify-between gap-4 mb-3 pr-20">
            <div>
              <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5 m-0">
                For serious artists
              </p>
              <p className="font-display text-lg uppercase tracking-tight text-foreground m-0">
                Studio
              </p>
            </div>
            <div className="text-right shrink-0">
              <span className="text-xl font-bold text-ember tabular-nums">$29</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest">/mo</span>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2 m-0">
            Everything in Band, plus:
          </p>
          <ul className="space-y-1.5 mb-3">
            {STUDIO_FEATURES.map(f => (
              <li key={f} className="flex items-start gap-2 text-[11px] text-muted-foreground leading-snug">
                <CheckIcon />
                {f}
              </li>
            ))}
          </ul>
          <TbButton
            variant="primary"
            className="w-full justify-center"
            disabled={busy}
            onClick={() => handleSelect('studio')}
          >
            {busy ? 'Saving…' : 'Select Studio'}
          </TbButton>
        </div>
      </div>

      {/* Current free limits */}
      <div className="border border-border bg-background px-3 py-2.5 mb-4">
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1.5 m-0">
          Your current free plan
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {FREE_LIMITS.map(f => (
            <span key={f} className="text-[10px] text-muted-foreground/50">{f}</span>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground text-center m-0">
        No payment required now. We&apos;ll notify you before billing starts.
      </p>
    </TbModal>
  )
}
