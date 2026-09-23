import PrivacyDocument from '@/components/legal/PrivacyDocument'
import { buildSlicePageMetadata } from '@/lib/seo'

export const metadata = buildSlicePageMetadata({
  title: 'Privacy Policy',
  description: 'What personal data sonicdesk collects, why, who it is shared with, how long it is kept, and your rights under the GDPR.',
  path: '/privacy',
})

/** Static legal page — public (see middleware.ts) and prerendered. */
export const dynamic = 'force-static'

export default function Page() {
  return <PrivacyDocument />
}
