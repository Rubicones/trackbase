'use client'

/**
 * The whole of a campaign landing page.
 *
 * `/maskeliade` has no UI of its own — it is an attribution capture point that
 * forwards to sign-in. It stores the campaign's source/cohort, then replaces
 * itself with `/auth`, so the user experiences one page: sign-in.
 *
 * The store and the redirect are consecutive statements in one effect, so there
 * is no path to /auth that skips the write. (A layout effect would move both a
 * frame earlier and buy nothing, at the cost of React's "useLayoutEffect does
 * nothing on the server" warning during SSR.)
 *
 * The redirect is `replace`, not `push`, so Back from sign-in goes wherever the
 * user came from rather than bouncing through this route again. No `next` is
 * passed: `sanitizeRedirectPath` then falls back to /dashboard, which is where
 * a fresh signup should land anyway.
 *
 * An unknown slug stores nothing and still forwards to /auth — a dead campaign
 * link degrades into an ordinary sign-in link rather than a 404.
 *
 * Already-signed-in users are not special-cased here. They get their values
 * stored (harmless — attribution is only ever read while a profile is being
 * created, and theirs already exists) and land on /auth, where the middleware
 * bounces them to /dashboard exactly as it does for any other sign-in visit.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getCampaign } from '@/lib/campaigns'
import { storeAttribution } from '@/lib/attribution'
import { AuthLoadingScreen } from '@/components/auth/AuthShell'

export function CampaignRedirect({ slug }: { slug: string }) {
  const router = useRouter()

  useEffect(() => {
    const campaign = getCampaign(slug)
    // First-touch attribution: storeAttribution declines to overwrite an
    // earlier campaign, so ordering between competing links is decided there.
    if (campaign) storeAttribution(campaign.source, campaign.cohort)
    router.replace('/auth')
  }, [slug, router])

  return <AuthLoadingScreen label="Taking you to sign in" />
}
