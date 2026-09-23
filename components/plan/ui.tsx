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
 * The three wave accents are declared at the theme root in
 * `app/design-system.css` and registered as Tailwind colours in the `@theme`
 * block of `app/globals.css`, which is what makes `text-wave-amber` a real
 * utility. Never reach for `text-[var(--wave-amber)]` instead: an arbitrary
 * value pointing at a var that is out of scope produces no error and no
 * colour, and that is exactly how every amber surface in this app spent a
 * while rendering white.
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
    text: 'text-wave-amber',
    border: 'border-wave-amber/40',
    wash: 'bg-wave-amber/8',
    fill: 'bg-wave-amber',
    solid: 'bg-wave-amber text-primary-foreground',
  },
  destructive: {
    text: 'text-destructive',
    border: 'border-destructive/40',
    wash: 'bg-destructive/8',
    fill: 'bg-destructive',
    solid: 'bg-destructive text-primary-foreground',
  },
  mint: {
    text: 'text-wave-mint',
    border: 'border-wave-mint/40',
    wash: 'bg-wave-mint/8',
    fill: 'bg-wave-mint',
    solid: 'bg-wave-mint text-primary-foreground',
  },
  violet: {
    text: 'text-wave-violet',
    border: 'border-wave-violet/40',
    wash: 'bg-wave-violet/8',
    fill: 'bg-wave-violet',
    solid: 'bg-wave-violet text-primary-foreground',
  },
}

// ── Actions ──────────────────────────────────────────────────────────────────

/**
 * The kit's buttons, which `TbButton` cannot express.
 *
 * `TbButton`'s shell is `text-[10px] uppercase tracking-widest` on every
 * variant — the app's control idiom, and right for a toolbar. The subscription
 * kit uses body-sized text on taller buttons for the decisions that involve
 * money, and the difference is deliberate: a 10px mono chip reads as a control,
 * and "Change plan" is not a control.
 *
 * Class strings rather than components because every call site already has its
 * own element, and a wrapper would only be a place to forget a prop.
 *
 * ⚠ `components/plan/GraceBanner.tsx` still carries its own `outlineAction` /
 * `solidAction` copies. Fold them into these once that file settles — two
 * spellings of one button is exactly the drift this module exists to stop.
 */
const ACTION_BASE =
  'font-body-tb inline-flex items-center justify-center gap-2 px-4 text-sm font-medium transition-colors disabled:opacity-50'

/** Inherits the surrounding tone through `currentColor`. */
export const actionOutlineTone = `${ACTION_BASE} h-9 border border-current bg-transparent text-current hover:bg-current/10`

/** Inverted surface — the kit's `--sub-fg` on `--sub-bg`. */
export const actionSolid = `${ACTION_BASE} h-9 border-0 bg-foreground text-background hover:opacity-90`

/** Red fill, for the one state that has earned it. */
export const actionDestructive = `${ACTION_BASE} h-9 border-0 bg-destructive text-destructive-foreground hover:opacity-90`

/** The primary money CTA: taller, accent fill, display caps. */
export const actionPrimaryTall = `${ACTION_BASE} font-display-tb h-11 border-0 bg-lime uppercase tracking-tight text-primary-foreground hover:opacity-90`

/** Its quieter sibling, same height. */
export const actionOutlineTall = `${ACTION_BASE} h-11 border border-border bg-transparent text-foreground hover:border-lime hover:text-lime`

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
    <div className={`font-body-tb border p-3 ${t.border} ${t.wash} ${className}`}>
      <div className="flex items-start gap-2">
        <span className={`mt-0.5 shrink-0 ${t.text}`}>
          <LucideIcon icon={CircleAlert} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-medium leading-6 text-foreground">{title}</p>
          {detail && (
            <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
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
  /** Rendered, not measured — a call site may mark an add-on inside it. */
  label: ReactNode
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
        className="mt-1.5 h-[3px] w-full bg-surface-2"
        role="progressbar"
        aria-label={typeof label === 'string' ? label : undefined}
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
        <p className="font-body-tb m-0 mt-1.5 text-xs leading-5 text-muted-foreground">{note}</p>
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
