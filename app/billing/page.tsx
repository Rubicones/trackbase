import { Suspense } from 'react'
import type { Metadata } from 'next'
import { BillingClient } from '@/app/billing/BillingClient'

export const metadata: Metadata = {
  title: 'Billing',
  // Nothing here should ever be indexed: it is one account's payment state.
  robots: { index: false, follow: false },
}

export default function BillingPage() {
  // `BillingClient` reads the checkout result out of the query string, which
  // needs a boundary here rather than a bail-out at build time.
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <BillingClient />
    </Suspense>
  )
}
