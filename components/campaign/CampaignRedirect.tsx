'use client'

/**
 * The whole of a campaign landing page.
 *
 * `/maskeliade` has no UI of its own — it is an attribution capture point that
 * forwards to the marketing landing page. It stores the campaign's
 * source/cohort, then replaces itself with `/`, so the visitor experiences one
 * page: the landing page they'd have seen anyway.
 *
 * **Attribution outlives the redirect.** The source/cohort go to localStorage,
 * not to the URL, so it does not matter how long the visitor browses the
 * marketing site or which route they eventually sign up from — the values are
 * still there when `PATCH /api/profile/username` claims them at account
 * creation. Sending them to `/` instead of `/auth` therefore costs no
 * attribution accuracy; it only adds the marketing page in front of the signup.
 *
 * The store and the redirect are consecutive statements in one effect, so there
 * is no path off this page that skips the write. (A layout effect would move
 * both a frame earlier and buy nothing, at the cost of React's
 * "useLayoutEffect does nothing on the server" warning during SSR.)
 *
 * The redirect is `replace`, not `push`, so Back goes wherever the user came
 * from rather than bouncing through this route again.
 *
 * An unknown slug stores nothing and still forwards to `/` — a dead campaign
 * link degrades into an ordinary landing-page link rather than a 404.
 *
 * Already-signed-in users are not special-cased here. They get their values
 * stored (harmless — attribution is only ever read while a profile is being
 * created, and theirs already exists) and land on the landing page, which is
 * public for signed-in users too (see `isRunningAsInstalledPWA` in
 * `components/LandingPage.tsx`: `/` only forwards to /dashboard for the
 * installed app, never on auth state).
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
    router.replace('/')
  }, [slug, router])

  return <AuthLoadingScreen label="Taking you to sonicdesk" />
}
