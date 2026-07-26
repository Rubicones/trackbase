import type { Metadata } from 'next'
import { CampaignRedirect } from '@/components/campaign/CampaignRedirect'

/**
 * Maskeliade school warm-test landing link.
 *
 * Everything about how a campaign behaves lives in `lib/campaigns.ts` and
 * `components/campaign/CampaignRedirect.tsx`. To add the next campaign, add a
 * registry entry and copy this file with a different slug — see the header of
 * `lib/campaigns.ts`.
 */

// A redirect stub with no content of its own; keep it out of the index so it
// never competes with the real marketing pages in search results.
export const metadata: Metadata = {
  title: 'Sign in — sonicdesk',
  robots: { index: false, follow: false },
}

export default function MaskeliadeCampaignPage() {
  return <CampaignRedirect slug="maskeliade" />
}
