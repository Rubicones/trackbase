import type { OnboardingData } from '@/contexts/AuthContext'
import type { TourStep } from '@/components/onboarding/ProjectTour'

export type FeatureTourId = 'compare' | 'structure' | 'track_edit'

const COMPLETED_KEY: Record<FeatureTourId, keyof OnboardingData> = {
  compare: 'compare_tour_completed',
  structure: 'structure_tour_completed',
  track_edit: 'track_edit_tour_completed',
}

const SKIPPED_KEY: Record<FeatureTourId, keyof OnboardingData> = {
  compare: 'compare_tour_skipped',
  structure: 'structure_tour_skipped',
  track_edit: 'track_edit_tour_skipped',
}

export function isFeatureTourPending(
  onboarding: OnboardingData | undefined | null,
  id: FeatureTourId,
): boolean {
  if (!onboarding) return true
  return !onboarding[COMPLETED_KEY[id]] && !onboarding[SKIPPED_KEY[id]]
}

export function featureTourCompletedKey(id: FeatureTourId): keyof OnboardingData {
  return COMPLETED_KEY[id]
}

export function featureTourSkippedKey(id: FeatureTourId): keyof OnboardingData {
  return SKIPPED_KEY[id]
}

export const COMPARE_TOUR_STEPS: TourStep[] = [
  {
    target: 'compare-waveforms',
    title: 'Spot what changed',
    body: 'Waveforms for both versions sit side by side — scrub and flip between them to see what actually moved.',
  },
  {
    target: 'compare-ab-transport',
    title: 'Play A / Play B / Sync',
    body: 'Solo version A, solo version B, or Sync play to hear both lined up together.',
  },
  {
    target: 'compare-loop',
    title: 'Loop a section',
    body: 'Turn Loop on and pick a section from A or B to drill the same phrase while you compare.',
  },
]

const STRUCTURE_FOLLOW_UP: TourStep[] = [
  {
    target: 'structure-chords',
    title: 'Add chords',
    body: 'Type the chords for this section so the band never has to guess at rehearsal.',
  },
  {
    target: 'structure-detect-chords',
    title: 'Detect from audio',
    body: 'Or let sonicdesk suggest chords from the track — a starting point you can edit.',
  },
  {
    target: 'structure-performance-note',
    title: 'Performance notes',
    body: 'Short cues like “pull back” or “build” — visible when you rehearse.',
  },
]

export function buildStructureTourSteps(opts: {
  /** True when the project already had sections when Edit structure opened. */
  hasExistingSections: boolean
  hasDragEnded: () => boolean
  hasSection: () => boolean
  /** True once a section edit popover is open (user clicked a section). */
  hasSectionOpen: () => boolean
}): TourStep[] {
  if (opts.hasExistingSections) {
    return [
      {
        target: 'structure-add-section',
        title: 'Choose a section',
        body: 'Click any section on the strip to open it — we’ll continue once it’s selected.',
        gate: opts.hasSectionOpen,
        gateHint: 'Click a section to continue',
        autoAdvance: true,
      },
      ...STRUCTURE_FOLLOW_UP,
    ]
  }

  return [
    {
      target: 'structure-add-section',
      title: 'Drag to add a section',
      body: 'Click the structure strip and drag across the bars. Release when the range looks right — we’ll move on as soon as you let go.',
      gate: opts.hasDragEnded,
      gateHint: 'Drag across the bars, then release',
      autoAdvance: true,
    },
    {
      target: 'structure-section-name',
      title: 'Choose a name',
      body: 'Pick Intro, Verse, Chorus, or Custom so everyone knows what this part is.',
      gate: opts.hasSection,
      gateHint: 'Pick a section name to continue',
      autoAdvance: true,
    },
    ...STRUCTURE_FOLLOW_UP,
  ]
}
