import { makeSeededWaveformBars } from '@/components/WaveformBars'
import { defaultTrackIconColorForIndex } from '@/lib/trackIcon'
import type { Track, Version } from '@/lib/types'
import { waveformBarsCache } from '@/lib/waveformCache'

type OnboardingFlags = {
  project_tour_completed?: boolean
  project_tour_skipped?: boolean
  mobile_project_tour_completed?: boolean
  mobile_project_tour_skipped?: boolean
}

export const ONBOARDING_DEMO_TRACKS = [
  { name: 'guitar', display_name: 'Guitar', waveformSeed: 1.4 },
  { name: 'vocals', display_name: 'Vocals', waveformSeed: 2.8 },
  { name: 'bass', display_name: 'Bass', waveformSeed: 3.6 },
  { name: 'drums', display_name: 'Drums', waveformSeed: 4.2 },
  { name: 'keys', display_name: 'Keys', waveformSeed: 5.1 },
] as const

export const ONBOARDING_DEMO_VERSIONS = [
  { name: 'Better solo', tag: 'solo' },
  { name: 'Jazzy bass', tag: 'bass' },
  { name: 'Extended outro', tag: 'outro' },
] as const

export const ONBOARDING_DEMO_DURATION_MS = 60_000

const DEMO_ID_PREFIX = 'onboarding-demo:'

export function isOnboardingDemoId(id: string): boolean {
  return id.startsWith(DEMO_ID_PREFIX)
}

/** Desktop project tour not yet completed or skipped. */
export function isDesktopProjectTourPending(onboarding?: OnboardingFlags | null): boolean {
  if (!onboarding) return false
  return !onboarding.project_tour_completed && !onboarding.project_tour_skipped
}

/** Mobile project tour not yet completed or skipped. */
export function isMobileProjectTourPending(onboarding?: OnboardingFlags | null): boolean {
  if (!onboarding) return false
  return !onboarding.mobile_project_tour_completed && !onboarding.mobile_project_tour_skipped
}

/** @deprecated Use per-platform pending checks with active tour state instead. */
export function shouldShowOnboardingDemo(onboarding?: OnboardingFlags | null): boolean {
  return isDesktopProjectTourPending(onboarding) || isMobileProjectTourPending(onboarding)
}

/**
 * Overlay demo content only while a first-time tour is actively open.
 * Before the tour starts and after finish/skip the real (empty) project is shown.
 */
export function isOnboardingDemoActive(
  onboarding: OnboardingFlags | null | undefined,
  opts: { showDesktopTour: boolean; showMobileTour: boolean },
): boolean {
  return (
    (opts.showDesktopTour && isDesktopProjectTourPending(onboarding))
    || (opts.showMobileTour && isMobileProjectTourPending(onboarding))
  )
}

function demoTrackId(projectId: string, versionId: string, slug: string): string {
  return `${DEMO_ID_PREFIX}track:${projectId}:${versionId}:${slug}`
}

function demoVersionId(projectId: string, slug: string): string {
  return `${DEMO_ID_PREFIX}version:${projectId}:${slug}`
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function buildDemoTracksForVersion(projectId: string, versionId: string): Track[] {
  return ONBOARDING_DEMO_TRACKS.map((spec, position) => ({
    id: demoTrackId(projectId, versionId, spec.name),
    version_id: versionId,
    name: spec.name,
    display_name: spec.display_name,
    original_filename: `${spec.name}.wav`,
    file_hash: `${DEMO_ID_PREFIX}${projectId}:${spec.name}`,
    storage_path: '',
    duration_ms: ONBOARDING_DEMO_DURATION_MS,
    file_size_bytes: null,
    position,
    icon_emoji: null,
    icon_color: defaultTrackIconColorForIndex(position),
    file_type: 'audio' as const,
    midi_data: null,
    midi_start_bar: 0,
    start_bar: 0,
    comments: [],
  }))
}

function cloneTracksForVersion(tracks: Track[], versionId: string, projectId: string, branchSlug: string): Track[] {
  return tracks.map((track, position) => ({
    ...track,
    id: demoTrackId(projectId, versionId, `${branchSlug}:${track.name}`),
    version_id: versionId,
    position,
    comments: [],
  }))
}

/**
 * Overlay temporary demo tracks/versions for the onboarding tour.
 * Nothing is persisted — disappears once tour flags are set on the profile.
 */
export function buildOnboardingDisplayVersions(
  versions: Version[],
  projectId: string,
  demoActive: boolean,
): Version[] {
  if (!demoActive || versions.length === 0) return versions

  const main = versions.find(v => v.type === 'main')
  if (!main) return versions

  const hasRealTracks = versions.some(v => v.tracks.length > 0)
  const hasRealBranches = versions.some(v => v.type === 'branch')

  let result = versions.map(v => ({ ...v, tracks: [...v.tracks] }))

  if (!hasRealTracks) {
    result = result.map(v => ({
      ...v,
      tracks: buildDemoTracksForVersion(projectId, v.id),
    }))
  }

  if (!hasRealBranches) {
    const sourceTracks = result.find(v => v.id === main.id)?.tracks ?? []
    const demoVersions: Version[] = ONBOARDING_DEMO_VERSIONS.map(spec => {
      const slug = slugify(spec.name)
      const id = demoVersionId(projectId, slug)
      return {
        id,
        project_id: projectId,
        parent_id: main.id,
        name: spec.name,
        type: 'branch',
        created_at: new Date().toISOString(),
        merged_at: null,
        merged_into_id: null,
        tag: spec.tag,
        tracks: cloneTracksForVersion(sourceTracks, id, projectId, slug),
      }
    })
    result = [...result, ...demoVersions]
  }

  return result
}

export function seedOnboardingDemoWaveforms(versions: Version[]): void {
  for (const version of versions) {
    for (const track of version.tracks) {
      if (!isOnboardingDemoId(track.id)) continue
      const spec = ONBOARDING_DEMO_TRACKS.find(t => t.name === track.name)
      const seed = spec?.waveformSeed ?? track.id.charCodeAt(0)
      waveformBarsCache.set(track.id, makeSeededWaveformBars(seed))
    }
  }
}

export function clearOnboardingDemoWaveforms(versions: Version[]): void {
  for (const version of versions) {
    for (const track of version.tracks) {
      if (isOnboardingDemoId(track.id)) waveformBarsCache.delete(track.id)
    }
  }
}
