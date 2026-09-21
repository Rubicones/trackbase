'use client'

/**
 * The shared vocabulary of every plan and billing surface.
 *
 * Ported from the subscription design kit (`sonicdesk_designs`,
 * `/uikit/subscriptions`) onto this app's tokens. The kit paints on its own
 * palette — `--sub-bg`, `--sub-line`, `--color-primary` — which exists nowhere
 * here; the mapping is fixed once, in `TONE` and in the components below, so
 * that a future screen copied from the kit has somewhere to land instead of
 * inventing a sixth shade of amber.
 *
 *   --sub-bg      → --background      --color-primary     → --lime
 *   --sub-panel   → --surface         --color-warning     → --wave-amber
 *   --sub-card    → --card            --color-destructive → --destructive
 *   --sub-line    → --border          --color-accent-mint → --wave-mint
 *   --sub-muted   → --muted-foreground  …-violet          → --wave-violet
 *
 * Nothing here knows a limit, a price or a plan. These are the shapes; the
 * numbers arrive as props, and they arrive — always — from `lib/plans.ts` by
 * way of the server. A component in this file that hardcoded a figure would be
 * a second source of truth, which is the one failure this system is built to
 * avoid.
 */

import type { ReactNode } from 'react'
import { CircleAlert } from 'lucide'
import { LucideIcon } from '@/components/design/LucideIcon'
import type { Limit } from '@/lib/plans'

export type PlanTone = 'lime' | 'amber' | 'destructive' | 'mint' | 'violet'

interface ToneClasses {
  /** Foreground text in this tone. */
  text: string
  /** Hairline border, muted enough to sit under body copy. */
  border: string
  /** Barely-there wash for a banner background. */
  wash: string
  /** Solid fill — progress bars, badges that need to shout. */
  fill: string
  /** Solid fill with a readable foreground on top. */
  solid: string
}

export const TONE: Record<PlanTone, ToneClasses> = {
  lime: {
    text: 'text-lime',
    border: 'border-lime/40',
    wash: 'bg-lime/[0.06]',
    fill: 'bg-lime',
    solid: 'bg-lime text-primary-foreground',
  },
  amber: {
    text: 'text-[var(--wave-amber)]',
    border: 'border-[var(--wave-amber)]/40',
    wash: 'bg-[var(--wave-amber)]/[0.06]',
    fill: 'bg-[var(--wave-amber)]',
    solid: 'bg-[var(--wave-amber)] text-primary-foreground',
  },
  destructive: {
    text: 'text-destructive',
    border: 'border-destructive/40',
    wash: 'bg-destructive/[0.06]',
    fill: 'bg-destructive',
    solid: 'bg-destructive text-primary-foreground',
  },
  mint: {
    text: 'text-[var(--wave-mint)]',
    border: 'border-[var(--wave-mint)]/40',
    wash: 'bg-[var(--wave-mint)]/[0.06]',
    fill: 'bg-[var(--wave-mint)]',
    solid: 'bg-[var(--wave-mint)] text-primary-foreground',
  },
  violet: {
    text: 'text-[var(--wave-violet)]',
    border: 'border-[var(--wave-violet)]/40',
    wash: 'bg-[var(--wave-violet)]/[0.06]',
    fill: 'bg-[var(--wave-violet)]',
    solid: 'bg-[var(--wave-violet)] text-primary-foreground',
  },
}

// ── Eyebrow ──────────────────────────────────────────────────────────────────

/**
 * Section marker. The `//` is the app's own idiom, not decoration — the
 * dashboard hero and the landing sections already open this way.
 */
export function Eyebrow({
  children,
  tone = 'lime',
  className = '',
}: {
  children: ReactNode
  tone?: PlanTone
  className?: string
}) {
  return (
    <div
      className={`font-mono-tb text-[9px] uppercase tracking-[0.24em] ${TONE[tone].text} ${className}`}
    >
      {'// '}
      {children}
    </div>
  )
}

// ── Status badge ─────────────────────────────────────────────────────────────

export function StatusBadge({
  children,
  tone = 'amber',
  className = '',
}: {
  children: ReactNode
  tone?: PlanTone
  className?: string
}) {
  const t = TONE[tone]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 border px-1.5 py-1 font-mono-tb text-[8px] uppercase leading-none tracking-[0.18em] ${t.text} ${t.border} ${t.wash} ${className}`}
    >
      {children}
    </span>
  )
}

// ── Inline notice ────────────────────────────────────────────────────────────

/**
 * One refusal, one explanation. The two halves are separate props because
 * every limit message in `lib/planCopy.ts` is built the same way — headline,
 * then what the user can do about it — and a component that took one blob
 * would invite call sites to drop the second half.
 */
export function InlineNotice({
  title,
  detail,
  tone = 'destructive',
  action,
  className = '',
}: {
  title: ReactNode
  detail?: ReactNode
  tone?: PlanTone
  action?: ReactNode
  className?: string
}) {
  const t = TONE[tone]
  return (
    <div className={`border px-3 py-2.5 ${t.border} ${t.wash} ${className}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-px shrink-0 ${t.text}`}>
          <LucideIcon icon={CircleAlert} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 font-mono-tb text-[11px] leading-relaxed text-foreground">{title}</p>
          {detail && (
            <p className="m-0 mt-1 font-mono-tb text-[10px] leading-relaxed text-muted-foreground">
              {detail}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  )
}

// ── Usage bar ────────────────────────────────────────────────────────────────

/** At or above this fraction of a ceiling, the bar starts warning. */
export const NEAR_LIMIT_FRACTION = 0.8

export function usageFraction(current: number, limit: Limit): number | null {
  if (limit === null || limit <= 0) return null
  return current / limit
}

/**
 * The tone a given usage deserves. Exported because the surrounding copy has
 * to agree with the bar: a paragraph saying "you're fine" above a red bar is
 * worse than either alone.
 */
export function usageTone(current: number, limit: Limit): PlanTone {
  const f = usageFraction(current, limit)
  if (f === null) return 'lime'
  if (f >= 1) return 'destructive'
  return f >= NEAR_LIMIT_FRACTION ? 'amber' : 'lime'
}

export function UsageBar({
  label,
  current,
  limit,
  render,
  note,
  className = '',
}: {
  label: string
  current: number
  limit: Limit
  /** Formats both numbers — bytes, megabytes, plain counts. */
  render?: (value: number) => string
  note?: ReactNode
  className?: string
}) {
  const tone = usageTone(current, limit)
  const fraction = usageFraction(current, limit)
  const show = render ?? ((value: number) => String(value))

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </span>
        <span
          className={`font-mono-tb text-[11px] ${tone === 'lime' ? 'text-foreground' : TONE[tone].text}`}
        >
          {show(current)}
          <span className="text-muted-foreground">
            {' / '}
            {limit === null ? 'Unlimited' : show(limit)}
          </span>
        </span>
      </div>
      <div
        className="mt-1.5 h-[3px] w-full bg-surface"
        role="progressbar"
        aria-label={label}
        aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {fraction !== null && (
          <div
            className={`h-full transition-[width] duration-700 ease-out ${TONE[tone].fill}`}
            style={{ width: `${Math.min(100, Math.round(fraction * 100))}%` }}
          />
        )}
      </div>
      {note && (
        <p className="m-0 mt-1.5 font-mono-tb text-[10px] leading-relaxed text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

/** The kit's framed block: hairline border, panel fill, labelled header. */
export function PlanPanel({
  label,
  children,
  right,
  className = '',
}: {
  label?: ReactNode
  children: ReactNode
  right?: ReactNode
  className?: string
}) {
  return (
    <section className={`border border-border bg-surface/40 ${className}`}>
      {(label || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          {label && (
            <div className="flex min-w-0 items-center gap-2 font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              <span className="size-1.5 shrink-0 bg-lime" aria-hidden />
              <span className="truncate">{label}</span>
            </div>
          )}
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}
