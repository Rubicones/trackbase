'use client'

/**
 * Cookie consent bar (visual port of sonicdesk_designs/src/components/cookie-banner.tsx),
 * driven by <ConsentProvider />. "Reject all" and "Accept all" sit side by
 * side with identical size, style and contrast — one click each.
 *
 * NOTE: reconstructed after an accidental overwrite — review against the
 * intended implementation.
 */

import Link from 'next/link'
import { AnimatePresence, motion } from 'motion/react'
import { useConsent } from '@/components/consent/ConsentProvider'
import { PRIVACY_POLICY_HREF } from '@/lib/consent'

const choiceBtn =
  'border border-[color-mix(in_oklab,var(--foreground)_22%,transparent)] bg-[var(--surface)] px-4 py-1.5 font-mono-tb text-[10px] uppercase tracking-widest text-[var(--foreground)] transition-colors hover:border-[var(--primary)] hover:text-[var(--primary)]'

export function CookieBanner() {
  const { bannerOpen, reopened, choose, closeSettings } = useConsent()

  return (
    <AnimatePresence>
      {bannerOpen && (
        <motion.aside
          key="cookie-bar"
          role="region"
          aria-label="Cookie consent"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="cookie-banner fixed inset-x-0 bottom-0 z-[90] border-t border-[color-mix(in_oklab,var(--foreground)_22%,transparent)] bg-[color-mix(in_oklab,var(--surface-2)_95%,transparent)] pb-[env(safe-area-inset-bottom)] text-[var(--foreground)] backdrop-blur-sm"
        >
          <div className="h-px w-full bg-[var(--primary)]" />
          <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
            <p className="min-w-0 flex-1 font-body-tb text-[11px] leading-snug text-[color-mix(in_oklab,var(--foreground)_75%,transparent)]">
              <span className="mr-2 font-mono-tb text-[9px] uppercase tracking-widest text-[var(--primary)]">● cookies</span>
              Necessary ones keep sonicdesk. running.{' '}
              <Link
                href={PRIVACY_POLICY_HREF}
                className="text-[var(--foreground)] underline decoration-[var(--border)] underline-offset-4 hover:text-[var(--primary)]"
              >
                Privacy policy
              </Link>
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              {reopened && (
                <button
                  type="button"
                  onClick={closeSettings}
                  className="mr-1 font-mono-tb text-[9px] uppercase tracking-widest text-[color-mix(in_oklab,var(--foreground)_55%,transparent)] hover:text-[var(--primary)]"
                >
                  Close
                </button>
              )}
              <button type="button" onClick={() => choose('rejected')} className={`${choiceBtn} flex-1 sm:flex-none`}>
                Reject all
              </button>
              <button type="button" onClick={() => choose('accepted')} className={`${choiceBtn} flex-1 sm:flex-none`}>
                Accept all
              </button>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
