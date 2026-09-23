import RefundDocument from '@/components/legal/RefundDocument'
import { buildSlicePageMetadata } from '@/lib/seo'

export const metadata = buildSlicePageMetadata({
  title: 'Refund Policy',
  description: 'How cancellations, refunds, the EU right of withdrawal and failed payments work at sonicdesk.',
  path: '/refund',
})

/** Static legal page — public (see middleware.ts) and prerendered. */
export const dynamic = 'force-static'

export default function Page() {
  return <RefundDocument />
}
