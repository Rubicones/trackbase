import TermsDocument from '@/components/legal/TermsDocument'
import { buildSlicePageMetadata } from '@/lib/seo'

export const metadata = buildSlicePageMetadata({
  title: 'Terms of Service',
  description: 'The agreement between you and sonicdesk: who owns the music you upload, bands and shared work, plans and payment, frozen bands, deletion, and your rights as an EU consumer.',
  path: '/terms',
})

/** Static legal page — public (see middleware.ts) and prerendered. */
export const dynamic = 'force-static'

export default function Page() {
  return <TermsDocument />
}
