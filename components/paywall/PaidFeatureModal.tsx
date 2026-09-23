'use client'

/**
 * What a locked feature actually is, before anyone is asked to pay for it.
 *
 * A 1:1 port of the kit's `PaidFeatureModal` (`sonicdesk_designs` →
 * `subscription-ui.tsx`): eyebrow, oversized title, one-line description, then
 * a three-card gallery where each card is one benefit with its picture behind
 * the caption. "See plans" hands off to `PlansModal`.
 *
 * ── Why it sits between the lock and the pricing ────────────────────────────
 * Clicking a lock used to open the plans table directly, which answers "what
 * does it cost" to someone who just asked "what is it". This answers the
 * question they asked. The demand signal is unchanged — `usePaywallGate`
 * already fired `paywall_lock_clicked` before this opened.
 *
 * ── The copy is product truth, not the kit's ────────────────────────────────
 * The kit describes `track-editor` as a MIDI editor. In this app `track_edit`
 * is AUDIO editing — split/duplicate/copy/paste on a quarter-bar grid, applied
 * by a server-side re-render to a new FLAC (AGENTS.md §4). The MIDI piano roll
 * is a different, ungated feature. Every line below was written from §4 rather
 * than carried over, because a paywall that misdescribes what it is selling is
 * worse than one that says nothing.
 *
 * ── Never state which plan ──────────────────────────────────────────────────
 * "Included with" is derived from `PLANS` by finding the cheapest plan whose
 * feature list contains this feature. Writing "Solo and above" here would be a
 * plan fact outside `lib/plans.ts`, which is the one thing AGENTS.md §7
 * forbids without exception.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, X } from 'lucide'
import { usePlanTracking } from '@/contexts/PaywallContext'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { LucideIcon } from '@/components/design/LucideIcon'
import { Eyebrow } from '@/components/plan/ui'
import { useDesignTheme } from '@/lib/design-theme'
import { DESIGN_THEMES } from '@/lib/design-theme-shared'
import { PLANS, PLAN_ORDER, type GatedFeature } from '@/lib/plans'

function emptySubscribe() {
  return () => {}
}

/**
 * Where the benefit pictures live.
 *
 * `public/paywall/<feature>-<n>-<mode>.webp`, 1-indexed in the order the
 * benefits are listed below, and one file per mode. A benefit with no `image`
 * renders a frame naming the file it expects, so the gallery stays legible
 * while the rest are being made and nothing 404s in the meantime.
 */
const IMAGE_DIR = '/paywall'

export function expectedBenefitImage(
  feature: GatedFeature,
  index: number,
  mode: 'dark' | 'light',
): string {
  return `${IMAGE_DIR}/${feature}-${index + 1}-${mode}.webp`
}

/**
 * The page colour a feature's screenshots were taken on.
 *
 * The card is painted with this rather than with a theme token, and that is the
 * whole trick: the picture has to stop looking like a picture. A card on
 * `--surface` would frame every screenshot in a visible rectangle a few percent
 * off from its own background.
 *
 * ⚠ It belongs to the FEATURE, not to the app. These are shot at different
 * times on different surfaces — A/B compare came off `#050505`, chord detect
 * off `#0d0d0d` — and a single shared constant silently reframed one of the two
 * sets. Sample the corners of the exported files; never guess, and never assume
 * the next batch matches the last.
 */
interface Canvas {
  dark: string
  light: string
}

interface BenefitImage {
  dark: string
  light: string
}

interface Benefit {
  title: string
  detail: string
  /** Both modes, or neither — see `expectedBenefitImage`. */
  image?: BenefitImage
}

function shot(feature: GatedFeature, index: number): BenefitImage {
  return {
    dark: expectedBenefitImage(feature, index, 'dark'),
    light: expectedBenefitImage(feature, index, 'light'),
  }
}

interface FeatureContent {
  eyebrow: string
  title: string
  description: string
  /** Sampled from the shipped images. Absent until a feature has any. */
  canvas?: Canvas
  benefits: [Benefit, Benefit, Benefit]
}

const CONTENT: Record<GatedFeature, FeatureContent> = {
  ab_compare: {
    eyebrow: 'Versions · A/B compare',
    title: 'Compare versions',
    description:
      'Play two versions against each other without losing your place — or your ear for what actually changed.',
    canvas: { dark: '#050505', light: '#fdfcfb' },
    benefits: [
      {
        title: 'Sync play',
        detail:
          'Both versions run on one playhead, so a switch lands on the same beat and never costs you the moment you were listening for.',
        image: shot('ab_compare', 0),
      },
      {
        title: 'Volume on each side',
        detail:
          'Balance the two before you judge them, and see at a glance which tracks exist in only one version instead of wondering where something went.',
        image: shot('ab_compare', 1),
      },
      {
        title: 'Loop the same section',
        detail:
          'Pick a section on each side and hear just that part — chorus against chorus, as many times as it takes to be sure.',
        image: shot('ab_compare', 2),
      },
    ],
  },

  track_edit: {
    eyebrow: 'Tracks · editor',
    title: 'Edit a take in place',
    description:
      'Split, duplicate, copy and paste audio on the song’s own grid, and get a real file back — attached to the version you were working in.',
    // Measured across the whole border of each shot, not the four corners: this
    // set is cropped tight to the interface, so the corners are waveform and
    // ruler rather than page. Dark settles on #000000 (the third shot's
    // #0c0c08 is 12 levels away and invisible); light on #fbfaf8, the page
    // value present in the set — the #d9d7d4 bands at some edges are the bar
    // ruler, which is UI and is meant to be seen.
    canvas: { dark: '#000000', light: '#fbfaf8' },
    benefits: [
      {
        title: 'Any grid, down to a quarter bar',
        detail:
          'Snap to whole bars, halves or quarters. A phrase that starts off the downbeat is still something you can cut cleanly.',
        image: shot('track_edit', 0),
      },
      {
        title: 'Copy, paste, duplicate, delete',
        detail:
          'Select a range and work on it the way you would with text — double the chorus, drop a bar, move a phrase — against the whole arrangement rather than in a separate editor.',
        image: shot('track_edit', 1),
      },
      {
        title: 'Applied in place',
        detail:
          'Confirm and the track is re-rendered into a real file on the same version, so everyone hears the edit. Nothing to export, re-upload or reconnect — and editing the master take asks first.',
        image: shot('track_edit', 2),
      },
    ],
  },

  chord_detect: {
    eyebrow: 'Structure · chord detect',
    title: 'Get the chords from the audio',
    description:
      'Run detection over the tracks you choose and start from a chord map instead of an empty structure editor.',
    canvas: { dark: '#0d0d0d', light: '#ffffff' },
    benefits: [
      {
        title: 'Nothing entered by hand',
        detail:
          'Press Detect instead of scrubbing the take and typing every chord in yourself. It runs in your own browser, so nothing is uploaded to do it.',
        image: shot('chord_detect', 0),
      },
      {
        title: 'You choose the source',
        detail:
          'Pick which tracks to analyse. Point it at the rhythm guitar rather than the vocal and it listens to what actually carries the harmony.',
        image: shot('chord_detect', 1),
      },
      {
        title: 'They land on the grid',
        detail:
          'Every chord attaches to its own bar and section, so the map lines up with the arrangement — and any one it got wrong is just text you retype.',
        image: shot('chord_detect', 2),
      },
    ],
  },

  cherry_pick: {
    eyebrow: 'Versions · cherry-pick',
    title: 'Take the parts that worked',
    description:
      'See exactly what a version changed, then apply only the pieces you want instead of the whole thing.',
    // Sampled across this set: the uniform shots sit on #040404 / #fcfcfa and
    // #000000 / #fbfaf8 — a one-to-four level spread, which is invisible. The
    // timeline shot has UI chrome at its own edges and is not expected to blend.
    canvas: { dark: '#040404', light: '#fbfaf9' },
    benefits: [
      {
        title: 'Apply only what you want',
        detail:
          'Tracks, arrangement bars and comments are listed separately, each with its own checkbox. Take the chorus edit and leave the rest in the branch.',
        image: shot('cherry_pick', 0),
      },
      {
        title: 'All of it on one timeline',
        detail:
          'Every difference is drawn where it happens in the song, so you see a track that moved or a section that was rewritten instead of reading a list of names.',
        image: shot('cherry_pick', 1),
      },
      {
        title: 'Hear the result first',
        detail:
          'Switch to the result preview and listen to exactly what applying would produce. The same code builds that preview and performs the merge, so nothing changes between hearing it and keeping it.',
        image: shot('cherry_pick', 2),
      },
    ],
  },
}

/**
 * The cheapest plan that includes this feature, in the kit's wording.
 *
 * Derived, never written: a hardcoded "Solo and above" here would be a second
 * source of truth for a plan's contents, and it would go stale silently the
 * first time a feature moved tier.
 */
function includedWith(feature: GatedFeature): string {
  const plan = PLAN_ORDER.find(id => PLANS[id].features.includes(feature))
  if (!plan) return 'A paid plan'
  const isTop = PLAN_ORDER[PLAN_ORDER.length - 1] === plan
  return isTop ? PLANS[plan].name : `${PLANS[plan].name} and above`
}

function BenefitCard({
  feature,
  benefit,
  index,
  isLight,
  canvas,
}: {
  feature: GatedFeature
  benefit: Benefit
  index: number
  isLight: boolean
  canvas?: Canvas
}) {
  const src = benefit.image ? (isLight ? benefit.image.light : benefit.image.dark) : null

  return (
    <article
      className={`group relative flex min-h-[250px] flex-col overflow-hidden md:min-h-[350px] ${
        canvas ? '' : 'bg-background'
      }`}
      // Not a token: the card is painted the colour THIS FEATURE's screenshots
      // were taken on, so its edges disappear. See `Canvas`.
      style={canvas ? { backgroundColor: isLight ? canvas.light : canvas.dark } : undefined}
    >
      {/*
        The art is IN FLOW and the caption sits under it, rather than the kit's
        caption floating over a full-bleed image. The kit's shots are landscape;
        ours are whatever the feature needed, and `cherry_pick-1` is PORTRAIT
        (407×471). Absolutely positioned art with the caption's height reserved
        under it gave that one about 220px to live in — a 47% scale, at which
        the interface in the screenshot is no longer readable, which defeats the
        point of showing it. In flow, the card grows, and because grid items
        stretch, the other two match its height and centre their strips in the
        extra room.

        `w-auto max-w-full` and no `w-full`: a narrow strip renders at its own
        size. Stretching a UI screenshot to the card width is the fastest way to
        make it look like a picture of an interface rather than one.
      */}
      <div className="flex flex-1 items-center justify-center px-5 py-6" aria-hidden>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- fixed art with known dimensions; next/image buys nothing for a static asset in a fixed frame.
          <img src={src} alt="" className="max-h-[340px] w-auto max-w-full object-contain" />
        ) : (
          <span className="font-mono-tb text-center text-[9px] uppercase leading-5 tracking-[0.18em] text-muted-foreground/50">
            {expectedBenefitImage(feature, index, isLight ? 'light' : 'dark')}
          </span>
        )}
      </div>

      <div className="m-4 mt-0 border border-border bg-surface/90 p-4 transition-colors group-hover:border-lime/55">
        <div className="flex items-center gap-2">
          <span className="size-1.5 shrink-0 bg-lime" aria-hidden />
          <h3 className="font-display-tb m-0 text-lg uppercase tracking-normal! text-foreground">
            {benefit.title}
          </h3>
        </div>
        <p className="font-body-tb m-0 mt-2 text-xs leading-5 text-muted-foreground">
          {benefit.detail}
        </p>
      </div>
    </article>
  )
}

export function PaidFeatureModal({
  feature,
  onClose,
  onSeePlans,
}: {
  feature: GatedFeature
  onClose: () => void
  onSeePlans: () => void
}) {
  const content = CONTENT[feature]
  const track = usePlanTracking()

  // Which screenshot to show. `DESIGN_THEMES` already records a mode per theme,
  // so this asks that table rather than keeping a second list of which themes
  // are light — the kind of list that goes stale the first time one is added.
  const { theme } = useDesignTheme()
  const isLight = DESIGN_THEMES.find(t => t.id === theme)?.mode === 'light'

  const domReady = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )
  useBodyScrollLock(domReady)

  useEffect(() => {
    track('paywall_feature_modal_opened', { feature })
  }, [feature, track])

  const close = useCallback(() => {
    track('paywall_feature_modal_closed', { feature })
    onClose()
  }, [feature, onClose, track])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  if (!domReady) return null

  return createPortal(
    <div
      className="tb-plans-backdrop fixed inset-0 z-[8000] grid place-items-center overflow-y-auto overscroll-none bg-background/90 p-3 backdrop-blur-md sm:p-6"
      onMouseDown={e => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="paid-feature-title"
        className="tb-plans-kit tb-plans-sheet font-body-tb relative my-auto w-full max-w-6xl overflow-hidden border border-border bg-surface text-foreground shadow-2xl"
      >
        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className="absolute right-2 top-2 z-20 grid size-9 place-items-center border border-border bg-background text-foreground transition-colors hover:border-lime hover:text-lime"
        >
          <LucideIcon icon={X} size={16} />
        </button>

        <header className="px-5 pb-7 pt-8 sm:px-8 sm:pb-9 sm:pt-10 lg:px-10">
          <Eyebrow>{content.eyebrow}</Eyebrow>
          <div className="mt-4 grid gap-4 pr-12 lg:grid-cols-[1fr_420px] lg:items-end">
            <h2
              id="paid-feature-title"
              className="font-display-tb m-0 text-4xl uppercase leading-[.9] tracking-normal! sm:text-6xl lg:text-7xl"
            >
              {content.title}
            </h2>
            {/*
              No colour utility and no opacity MODIFIER — `opacity` on the
              element instead.
              
              This line rendered white twice: first as `text-muted-foreground`,
              then as `text-foreground/75`. Sampling the pixels of the second
              report settled what was happening — under a selection the glyphs
              were white on the highlight, and outside it there was not one
              dark pixel in the paragraph's whole bounding box. The text was not
              faint, it was white on white.
              
              What both spellings share is that globals.css hand-overrides them
              for the landing page with hardcoded DARK-theme values
              (`.landing-page .text-muted-foreground`, `.landing-page
              .text-foreground\/75` — a near-white oklch(0.93)). The h2 beside
              this paragraph carries no colour utility, inherits from the
              sheet's `text-foreground`, and renders correctly in the very same
              screenshot. So this takes the h2's route: inherit the colour that
              demonstrably works, and get the muted feel from `opacity`, which
              composites the element and cannot be reached by a colour rule at
              all.
            */}
            <p className="m-0 text-sm leading-6 opacity-70 sm:text-base">
              {content.description}
            </p>
          </div>
        </header>

        {/* Opaque cards over a `bg-border` grid: the gaps are the hairlines. A
            translucent card would let that line colour through its whole face. */}
        <div className="grid min-h-[350px] gap-px bg-border md:grid-cols-3">
          {content.benefits.map((benefit, index) => (
            <BenefitCard
              key={benefit.title}
              feature={feature}
              benefit={benefit}
              index={index}
              isLight={isLight}
              canvas={content.canvas}
            />
          ))}
        </div>

        <footer className="flex flex-col gap-4 border-t border-border p-5 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
          <div>
            <div className="font-mono-tb text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
              Included with
            </div>
            <div className="font-display-tb mt-1 text-lg uppercase tracking-normal!">
              {includedWith(feature)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              track('plan_cta_clicked', { source: 'feature_modal', cta: 'see_plans', feature })
              onSeePlans()
            }}
            className="font-display-tb inline-flex h-12 min-w-56 items-center justify-center gap-2 bg-lime text-sm uppercase tracking-normal! text-primary-foreground transition-opacity hover:opacity-90"
          >
            See plans
            <LucideIcon icon={ArrowRight} size={16} />
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
