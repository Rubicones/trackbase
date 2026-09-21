'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { GatedFeature, Limit } from '@/lib/plans'

/**
 * What the band in the URL is entitled to, resolved on the SERVER.
 *
 * Why this exists: every paywall surface in a band keys off the BAND's plan,
 * not the viewer's — a free member of a paid band is entitled to what the owner
 * paid for, and for `ab_compare` and `chord_detect` the client gate is the only
 * gate there is (`lib/plans.ts`). The only sources used to be
 * `GET /api/projects/[id]` and `GET /api/bands/[id]`, both of which land after
 * hydration, after auth. Until they did, every gate and every ceiling in the
 * band had no answer — and each one guessed in a different direction.
 *
 * The band id is a path segment, so the server knows all of this before it
 * renders a byte. `app/band/[bandId]/layout.tsx` resolves it there.
 *
 * ⚠ TWO KINDS OF NULL, and they mean opposite things:
 *   · the SNAPSHOT is null  → nobody has answered. Wait. Never a ceiling, never
 *     "no ceiling", never a feature list.
 *   · a LIMIT inside it is null → answered, and the answer is UNLIMITED. This is
 *     the `Limit` vocabulary from `lib/plans.ts`, unchanged.
 *
 * ⚠ Display only, like every other client-side plan value. `lib/planGuards.ts`
 * re-checks all of it server-side on every request that acts on it.
 */
export interface BandPlanSnapshot {
  features: GatedFeature[]
  membersPerBand: Limit
  /** Bytes, or null for unlimited. Never the legacy 1 GB constant. */
  storagePerBandBytes: number | null
  activeVersionsPerProject: Limit
}

const BandPlanContext = createContext<BandPlanSnapshot | null>(null)

export function BandPlanProvider({
  plan,
  children,
}: {
  plan: BandPlanSnapshot | null
  children: ReactNode
}) {
  return <BandPlanContext.Provider value={plan}>{children}</BandPlanContext.Provider>
}

/** The band's resolved entitlements, or null when the server had no answer. */
export function useBandPlan(): BandPlanSnapshot | null {
  return useContext(BandPlanContext)
}

/**
 * Just the gated features, in the shape `usePaywallGate` takes.
 *
 * Null propagates deliberately: a gate reads it as "no answer yet" and renders
 * `pending`, not as "no features".
 */
export function useBandFeatures(): GatedFeature[] | null {
  return useContext(BandPlanContext)?.features ?? null
}
