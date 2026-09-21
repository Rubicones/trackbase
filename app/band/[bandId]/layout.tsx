import type { ReactNode } from 'react'
import { getBandEntitlements } from '@/lib/entitlements'
import { BandPlanProvider, type BandPlanSnapshot } from '@/components/plan/BandEntitlements'
import { mbToBytes } from '@/lib/plans'

/**
 * Resolves the band's entitlements before the shell renders.
 *
 * The band id is a path segment, so this is knowable at request time — there is
 * no reason for the browser to ask for it after hydration and then sit in an
 * unknown state while it waits. `GET /api/projects/[id]` and
 * `GET /api/bands/[id]` still return their own copies and still win once they
 * arrive; this is what the gates and ceilings read until then, instead of
 * nothing or, worse, a default.
 *
 * Cost is three indexed reads (owner, plan profile, addons). It replaces client
 * round trips that could not even start until auth had resolved, so the page is
 * not slower for it — but keep this the only entitlement work done here. Usage
 * counters, freeze settling and conflict checks are deliberately NOT in this
 * path: they are what makes `GET /api/me/plan` expensive, and nothing rendered
 * from this context needs them.
 *
 * A failure resolves to `null`, never to a guess in either direction. Null means
 * "keep waiting"; any concrete value here would be an answer this function is in
 * no position to invent.
 */
export default async function BandIdLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ bandId: string }>
}) {
  const { bandId } = await params

  let plan: BandPlanSnapshot | null = null
  try {
    const entitlements = await getBandEntitlements(bandId)
    plan = {
      features: [...entitlements.features],
      membersPerBand: entitlements.membersPerBand,
      storagePerBandBytes: mbToBytes(entitlements.storagePerBandMB),
      activeVersionsPerProject: entitlements.activeVersionsPerProject,
    }
  } catch (err) {
    console.error('[band] could not resolve band entitlements server-side', err)
  }

  return <BandPlanProvider plan={plan}>{children}</BandPlanProvider>
}
