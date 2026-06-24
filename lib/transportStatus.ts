import type { RecordState } from '@/components/RecordingTrackRow'

export type TransportStatusTone = 'muted' | 'accent' | 'destructive'

export type TransportStatus = {
  label: string
  tone: TransportStatusTone
  pulse?: boolean
  recordDot?: boolean
}

export type TransportStatusInput = {
  recordingState: RecordState | 'none' | 'idle'
  hasRecordingTrack: boolean
  playing: boolean
  isCounting: boolean
  playbackReady: boolean
  playbackMix: 'preview' | 'full' | 'none'
  tracksLoaded: number
  tracksTotal: number
  metronomeOn: boolean
  sectionLoopOn: boolean
  countdownOn: boolean
  activeSectionLabel?: string
}

function playingLabel(input: TransportStatusInput): string {
  const parts: string[] = ['playing']
  if (input.metronomeOn) parts.push('metro')
  if (input.sectionLoopOn) parts.push('loop')
  const section = input.activeSectionLabel?.trim().toLowerCase()
  if (section) parts.push(section)
  return parts.join(' · ')
}

function readyLabel(countdownOn: boolean): string {
  return countdownOn ? 'ready · countdown' : 'ready'
}

/** Resolve transport badge text + tone. Status priority is ascending — later checks win. */
export function resolveTransportStatus(input: TransportStatusInput): TransportStatus {
  const isPlaying = input.playing || input.isCounting
  const allTracksLoaded = input.tracksTotal === 0 || input.tracksLoaded >= input.tracksTotal

  let status: TransportStatus = { label: 'preview', tone: 'muted' }

  if (!input.playbackReady) {
    status = { label: 'fetching', tone: 'muted' }
  } else if (!isPlaying) {
    if (allTracksLoaded) {
      status = { label: readyLabel(input.countdownOn), tone: 'muted' }
    } else if (input.playbackMix === 'preview') {
      status = { label: 'preview', tone: 'muted' }
    } else {
      status = { label: 'fetching', tone: 'muted' }
    }
  }

  if (isPlaying) {
    status = { label: playingLabel(input), tone: 'accent' }
  }

  if (input.hasRecordingTrack && input.recordingState === 'armed') {
    status = { label: 'armed', tone: 'destructive' }
  }

  if (input.recordingState === 'recording' || input.recordingState === 'countdown') {
    status = { label: 'recording', tone: 'destructive', pulse: true, recordDot: true }
  }

  return status
}

export function transportStatusClass(status: TransportStatus): string {
  const base = 'inline-flex items-center gap-1 uppercase tracking-widest text-[8.5px] px-1.5 py-px border whitespace-nowrap max-w-[min(72vw,14rem)] truncate text-center'
  switch (status.tone) {
    case 'accent':
      return `${base} border-ember text-ember font-medium`
    case 'destructive':
      return `${base} border-destructive text-destructive font-medium${status.pulse ? ' font-bold animate-pulse' : ''}`
    default:
      return `${base} border-border text-muted-foreground`
  }
}
