/**
 * The one way an add-on route turns a failure into a response.
 *
 * ⚠ SERVER ONLY.
 */

import { NextResponse } from 'next/server'
import { AddonFlowError } from '@/lib/billing/addonOrders'
import { isBillingNotConfigured } from '@/lib/billing/stripe'

export function addonErrorResponse(err: unknown, label: string): NextResponse {
  if (err instanceof AddonFlowError) {
    return NextResponse.json(
      { error: err.code, message: err.message, ...err.extra },
      { status: err.status },
    )
  }
  if (isBillingNotConfigured(err)) {
    return NextResponse.json({ error: 'billing_unavailable' }, { status: 503 })
  }
  console.error(`[billing] ${label}`, err)
  return NextResponse.json(
    { error: 'billing_error', message: 'Could not reach billing. Nothing was changed.' },
    { status: 500 },
  )
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}
