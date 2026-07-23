'use client'

// The mixer playback engine — extracted verbatim from page.tsx (behavior-preserving refactor).
// Two-AudioContext rule: this hook only ever touches the shared 48 kHz playback
// context (lib/audioContext); recording uses its own context elsewhere.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Project, Track } from '@/lib/types'
import { trackEvent } from '@/lib/analytics'
import { isOnboardingDemoId } from '@/lib/onboardingDemo'
import { fetchTrackAudioBuffer } from '@/lib/waveformCache'
import {
  METRONOME_TRACK_ID,
  PREVIEW_MIX_TRACK_ID,
  generateMetronomeBuffer,
  snapToPreviousBarSec,
  startCountdown,
} from '@/lib/metronomeAudio'
import { getSharedAudioContext, getMasterOutput } from '@/lib/audioContext'
import { registerPlaybackStop } from '@/lib/playbackSession'
import {
  fetchPreviewMixBuffer,
  prefetchPreviewMixPlayback,
  previewMixPlaybackUrl,
  takePreloadedPreviewAudio,
} from '@/lib/previewMixClient'
import { midiRenderSourceKey, renderMidiTrackToBuffer } from '@/lib/midiRender'
import { warmMidiSoundfontModule } from '@/lib/midiSoundfont'
import type { EditPreviewPiece } from '@/lib/trackEdit'
import { trackTimelineEndSec } from './mixerUtils'

// ─── Player hook ──────────────────────────────────────────────────────────────

/** Short gain ramp to avoid audible clicks at every source start/stop boundary. */
export const RAMP_SECS = 0.008

export type RehearsalPlaybackOptions = {
  enabled: boolean
  projectId: string
  isMainVersion: boolean
}

export function usePlayer(
  tracks: Track[],
  versionId: string,
  project: Project | null,
  minPlaybackDuration = 0,
  timelineDurationSec = 0,
  rehearsal: RehearsalPlaybackOptions = { enabled: false, projectId: '', isMainVersion: false },
) {
  const actxRef = useRef<AudioContext | null>(null)
  const sourcesRef = useRef<AudioBufferSourceNode[]>([])
  const metronomeSrcRef = useRef<AudioBufferSourceNode | null>(null)
  const gainsRef = useRef<Map<string, GainNode>>(new Map())
  const masterGainRef = useRef<GainNode | null>(null)
  const bufsRef = useRef<Map<string, AudioBuffer>>(new Map())
  /** Updated every rAF frame — use for smooth visual updates (waveform overlays,
   *  progress bar fill). React state `currentTime` is throttled to ~5 Hz. */
  const currentTimeRef = useRef(0)
  const metronomeParamsRef = useRef<{ bpm: number; timeSig: string; duration: number } | null>(null)
  const startRef = useRef(0)
  const offsetRef = useRef(0)
  const rafRef = useRef(0)
  const [midiRenderingTracks, setMidiRenderingTracks] = useState<Set<string>>(() => new Set())
  const [midiPlaybackReadyIds, setMidiPlaybackReadyIds] = useState<Set<string>>(() => new Set())
  const midiRenderingTracksRef = useRef<Set<string>>(new Set())
  const midiRenderedKeysRef = useRef<Map<string, string>>(new Map())
  const midiRenderGenRef = useRef<Map<string, number>>(new Map())
  const midiRenderWaitersRef = useRef<Map<string, Array<() => void>>>(new Map())
  const [volume, setVolumeState] = useState(1)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  // Incremented on every seek so RecordingTrackRow's preview effect re-runs
  // and restarts the AudioBufferSourceNode from the correct position.
  const [seekEpoch, setSeekEpoch] = useState(0)
  const [loaded, setLoaded] = useState(0)
  const [previewMixReady, setPreviewMixReady] = useState(false)
  const usingPreviewMixRef = useRef(false)
  const pendingFullMixSwitchRef = useRef(false)
  const previewFetchGenRef = useRef(0)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const previewDecodeInflightRef = useRef<Promise<AudioBuffer | null> | null>(null)
  const rehearsalRef = useRef(rehearsal)
  rehearsalRef.current = rehearsal
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set())
  const mutedTracksRef = useRef<Set<string>>(new Set())
  const [soloedTracks, setSoloedTracks] = useState<Set<string>>(new Set())
  const soloedTracksRef = useRef<Set<string>>(new Set())
  const [trackGains, setTrackGainsState] = useState<Map<string, number>>(() => new Map())
  const trackGainsRef = useRef<Map<string, number>>(new Map())
  const playingRef = useRef(playing)
  playingRef.current = playing
  const [trackDurations, setTrackDurations] = useState<Map<string, number>>(new Map())
  const [metronomeOn, setMetronomeOn] = useState(false)
  const [countdownOn, setCountdownOn] = useState(false)
  const [isCounting, setIsCounting] = useState(false)
  const metronomeOnRef = useRef(false)
  metronomeOnRef.current = metronomeOn
  const countdownOnRef = useRef(false)
  countdownOnRef.current = countdownOn
  const isCountingRef = useRef(false)
  isCountingRef.current = isCounting
  const countdownCancelRef = useRef<(() => void) | null>(null)

  type SectionLoopRange = { id: string; startBar: number; endBar: number }
  const sectionLoopRef = useRef<SectionLoopRange | null>(null)
  const [sectionLoopOn, setSectionLoopOn] = useState(false)
  const playFnRef = useRef<(offset?: number) => Promise<void>>(async () => {})
  const skipPlaybackAnalyticsRef = useRef(false)

  /** Live edit-mode preview: while set, this track plays its uncommitted
   *  edit-session layout (bar-aligned slices of its buffer) instead of the
   *  raw stored file. */
  const editPreviewRef = useRef<{ trackId: string; pieces: EditPreviewPiece[] } | null>(null)

  const setEditPreview = useCallback((preview: { trackId: string; pieces: EditPreviewPiece[] } | null) => {
    editPreviewRef.current = preview
    // Re-schedule sources so the change is audible immediately during playback.
    if (playingRef.current) {
      skipPlaybackAnalyticsRef.current = true
      void playFnRef.current(offsetRef.current)
    }
  }, [])

  /** Metronome ignores solo/mute sets — only the Metro toggle controls it. */
  const gainForTrack = useCallback((
    trackId: string,
    soloSet: Set<string>,
    mutedSet: Set<string>,
  ) => {
    if (trackId === METRONOME_TRACK_ID) {
      return metronomeOnRef.current ? 1 : 0
    }
    if (trackId === PREVIEW_MIX_TRACK_ID) {
      const hasSolos = soloSet.size > 0
      return hasSolos && soloSet.has(PREVIEW_MIX_TRACK_ID) ? 1 : 0
    }
    if (midiRenderingTracksRef.current.has(trackId)) {
      return 0
    }
    const hasSolos = soloSet.size > 0
    return (hasSolos ? !soloSet.has(trackId) : mutedSet.has(trackId)) ? 0 : 1
  }, [])

  const effectiveGainForTrack = useCallback((
    trackId: string,
    soloSet: Set<string>,
    mutedSet: Set<string>,
  ) => gainForTrack(trackId, soloSet, mutedSet) * (trackGainsRef.current.get(trackId) ?? 1), [gainForTrack])

  const applyGainToTrackNode = useCallback((
    trackId: string,
    gainNode?: GainNode,
  ) => {
    const g = gainNode ?? gainsRef.current.get(trackId)
    if (!g) return
    const ctx = actxRef.current
    const targetVal = effectiveGainForTrack(trackId, soloedTracksRef.current, mutedTracksRef.current)
    if (ctx) {
      const now = ctx.currentTime
      g.gain.cancelScheduledValues(now)
      g.gain.setValueAtTime(g.gain.value, now)
      g.gain.linearRampToValueAtTime(targetVal, now + RAMP_SECS)
    } else {
      g.gain.value = targetVal
    }
  }, [effectiveGainForTrack])
  const minPlaybackDurationRef = useRef(minPlaybackDuration)
  minPlaybackDurationRef.current = minPlaybackDuration
  const timelineDurationSecRef = useRef(timelineDurationSec)
  timelineDurationSecRef.current = timelineDurationSec

  const getTransportDuration = useCallback(() => Math.max(
    duration,
    minPlaybackDurationRef.current,
    timelineDurationSecRef.current,
  ), [duration])

  // Only load audio tracks from the server; MIDI is offline-rendered client-side.
  const audioTracks = tracks.filter(t => t.file_type !== 'midi' && !isOnboardingDemoId(t.id))
  const audioTrackIdsKey = useMemo(
    () => audioTracks.map(t => t.id).sort().join('|'),
    [audioTracks],
  )
  const projectBpm = project?.bpm ?? 120
  const projectTimeSig = project?.time_signature ?? '4/4'
  const midiRenderDepsKey = useMemo(() => {
    const meta = tracks
      .filter(t => t.file_type === 'midi')
      .map(t => `${t.id}:${t.file_hash ?? ''}:${t.midi_data?.instrument ?? -1}:${t.midi_data?.notes?.length ?? 0}`)
      .sort()
      .join('|')
    return `${meta}|${projectBpm}|${projectTimeSig}`
  }, [
    tracks.map(t => `${t.id}:${t.file_hash ?? ''}:${t.midi_data?.instrument ?? -1}:${t.midi_data?.notes?.length ?? 0}:${t.file_type}`).join('|'),
    projectBpm,
    projectTimeSig,
  ])
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks
  const projectRef = useRef(project)
  projectRef.current = project

  const recomputeTransportDuration = useCallback(() => {
    const proj = projectRef.current
    if (!proj) return
    let maxDur = 0
    if (usingPreviewMixRef.current) {
      const previewAudio = previewAudioRef.current
      if (previewAudio && Number.isFinite(previewAudio.duration) && previewAudio.duration > 0) {
        maxDur = Math.max(maxDur, previewAudio.duration)
      }
      const previewBuf = bufsRef.current.get(PREVIEW_MIX_TRACK_ID)
      if (previewBuf) maxDur = Math.max(maxDur, previewBuf.duration)
    }
    for (const t of tracksRef.current) {
      const buf = bufsRef.current.get(t.id)
      maxDur = Math.max(maxDur, trackTimelineEndSec(
        t,
        proj.bpm ?? 120,
        proj.time_signature ?? '4/4',
        buf?.duration,
      ))
    }
    if (maxDur > 0) setDuration(maxDur)
  }, [])

  const clearPreviewMixPlayback = useCallback(() => {
    bufsRef.current.delete(PREVIEW_MIX_TRACK_ID)
    usingPreviewMixRef.current = false
    pendingFullMixSwitchRef.current = false
    setPreviewMixReady(false)
    if (previewAudioRef.current) {
      previewAudioRef.current.pause()
      previewAudioRef.current.src = ''
    }
    previewAudioRef.current = null
    previewDecodeInflightRef.current = null
    if (soloedTracksRef.current.has(PREVIEW_MIX_TRACK_ID)) {
      soloedTracksRef.current = new Set()
      setSoloedTracks(new Set())
    }
  }, [])

  const switchToFullMix = useCallback(() => {
    if (!usingPreviewMixRef.current) return
    bufsRef.current.delete(PREVIEW_MIX_TRACK_ID)
    usingPreviewMixRef.current = false
    pendingFullMixSwitchRef.current = false
    setPreviewMixReady(false)
    if (previewAudioRef.current) {
      previewAudioRef.current.pause()
      previewAudioRef.current.src = ''
    }
    previewAudioRef.current = null
    previewDecodeInflightRef.current = null
    if (soloedTracksRef.current.has(PREVIEW_MIX_TRACK_ID)) {
      soloedTracksRef.current = new Set()
      setSoloedTracks(new Set())
    }
    recomputeTransportDuration()
  }, [recomputeTransportDuration])

  const ensurePreviewMixBuffer = useCallback(async (ctx: AudioContext): Promise<AudioBuffer | null> => {
    const existing = bufsRef.current.get(PREVIEW_MIX_TRACK_ID)
    if (existing) return existing

    if (previewDecodeInflightRef.current) {
      return previewDecodeInflightRef.current
    }

    const projectId = rehearsalRef.current.projectId
    if (!projectId) return null

    const inflight = (async () => {
      const ab = await fetchPreviewMixBuffer(projectId)
      if (!ab?.byteLength) return null
      const decoded = await ctx.decodeAudioData(ab.slice(0))
      bufsRef.current.set(PREVIEW_MIX_TRACK_ID, decoded)
      recomputeTransportDuration()
      return decoded
    })().finally(() => {
      previewDecodeInflightRef.current = null
    })

    previewDecodeInflightRef.current = inflight
    return inflight
  }, [recomputeTransportDuration])

  const trySwitchToFullMix = useCallback(() => {
    if (!pendingFullMixSwitchRef.current || !usingPreviewMixRef.current) return
    if (playingRef.current) return
    switchToFullMix()
  }, [switchToFullMix])

  const markPendingFullMixSwitchIfReady = useCallback(() => {
    const r = rehearsalRef.current
    if (!r.enabled || !r.isMainVersion || !usingPreviewMixRef.current) return
    const audioIds = tracksRef.current.filter(t => t.file_type !== 'midi')
    if (audioIds.length === 0) return
    if (!audioIds.every(t => bufsRef.current.has(t.id))) return
    pendingFullMixSwitchRef.current = true
    trySwitchToFullMix()
  }, [trySwitchToFullMix])

  const canPlayBeforeTracksLoaded = useCallback(() => {
    const r = rehearsalRef.current
    return r.enabled && r.isMainVersion && previewMixReady && usingPreviewMixRef.current
  }, [previewMixReady])

  const noteTrackDuration = useCallback((trackId: string, ms: number) => {
    if (ms <= 0) return
    setTrackDurations(prev => {
      if (prev.get(trackId) === ms) return prev
      const next = new Map(prev)
      next.set(trackId, ms)
      return next
    })
    recomputeTransportDuration()
  }, [recomputeTransportDuration])

  // Full reset when switching versions.
  const prevVersionIdRef = useRef(versionId)
  useEffect(() => {
    if (prevVersionIdRef.current === versionId) return
    prevVersionIdRef.current = versionId
    sourcesRef.current.forEach(s => { try { s.stop() } catch { /* ok */ } })
    sourcesRef.current = []
    cancelAnimationFrame(rafRef.current)
    bufsRef.current.clear()
    midiRenderedKeysRef.current.clear()
    midiRenderGenRef.current.clear()
    midiRenderingTracksRef.current = new Set()
    setMidiRenderingTracks(new Set())
    setMidiPlaybackReadyIds(new Set())
    metronomeParamsRef.current = null
    setLoaded(0)
    setTrackDurations(new Map())
    setDuration(0)
    setPlaying(false)
    if (masterGainRef.current) {
      try { masterGainRef.current.disconnect() } catch { /* ok */ }
      masterGainRef.current = null
    }
    mutedTracksRef.current.add(METRONOME_TRACK_ID)
    setMutedTracks(prev => new Set([...prev, METRONOME_TRACK_ID]))
    setMetronomeOn(false)
    sectionLoopRef.current = null
    setSectionLoopOn(false)
    clearPreviewMixPlayback()
    trackGainsRef.current = new Map()
    setTrackGainsState(new Map())
  }, [versionId, clearPreviewMixPlayback])

  const resolveMidiRenderWaiters = useCallback((trackId: string) => {
    const waiters = midiRenderWaitersRef.current.get(trackId)
    if (!waiters?.length) return
    midiRenderWaitersRef.current.delete(trackId)
    for (const resolve of waiters) resolve()
  }, [])

  const finishMidiRender = useCallback((
    trackId: string,
    buffer: AudioBuffer,
    renderKey: string,
  ) => {
    bufsRef.current.set(trackId, buffer)
    midiRenderedKeysRef.current.set(trackId, renderKey)
    setMidiPlaybackReadyIds(prev => new Set(prev).add(trackId))

    midiRenderingTracksRef.current.delete(trackId)
    setMidiRenderingTracks(prev => {
      if (!prev.has(trackId)) return prev
      const next = new Set(prev)
      next.delete(trackId)
      return next
    })

    const decodedMs = Math.round(buffer.duration * 1000)
    setTrackDurations(prev => {
      const next = new Map(prev)
      next.set(trackId, decodedMs)
      return next
    })

    const nextMuted = new Set(mutedTracksRef.current)
    nextMuted.delete(trackId)
    mutedTracksRef.current = nextMuted
    setMutedTracks(nextMuted)

    recomputeTransportDuration()
    noteTrackDuration(trackId, decodedMs)
    resolveMidiRenderWaiters(trackId)

    const g = gainsRef.current.get(trackId)
    if (g) {
      const ctx = actxRef.current
      const targetVal = effectiveGainForTrack(trackId, soloedTracksRef.current, nextMuted)
      if (ctx) {
        const now = ctx.currentTime
        g.gain.cancelScheduledValues(now)
        g.gain.setValueAtTime(g.gain.value, now)
        g.gain.linearRampToValueAtTime(targetVal, now + RAMP_SECS)
      } else {
        g.gain.value = targetVal
      }
    }

    if (playingRef.current) {
      void playFnRef.current(offsetRef.current)
    }
  }, [recomputeTransportDuration, resolveMidiRenderWaiters, effectiveGainForTrack, noteTrackDuration])

  const finishMidiRenderRef = useRef(finishMidiRender)
  finishMidiRenderRef.current = finishMidiRender

  // Offline-render MIDI tracks to AudioBuffers for artifact-free transport playback.
  useEffect(() => {
    const midiTracksToRender = tracksRef.current.filter(t => t.file_type === 'midi')
    if (!midiTracksToRender.length) return
    warmMidiSoundfontModule()

    const ctx = getSharedAudioContext()
    actxRef.current = ctx
    const bpm = projectRef.current?.bpm ?? 120
    const timeSig = projectRef.current?.time_signature ?? '4/4'
    let cancelled = false

    for (const track of midiTracksToRender) {
      if (!track.midi_data?.notes?.length) continue
      const renderKey = midiRenderSourceKey(track, bpm, timeSig)
      if (midiRenderedKeysRef.current.get(track.id) === renderKey && bufsRef.current.has(track.id)) {
        continue
      }
      if (midiRenderingTracksRef.current.has(track.id)) {
        continue
      }

      const gen = (midiRenderGenRef.current.get(track.id) ?? 0) + 1
      midiRenderGenRef.current.set(track.id, gen)

      const nextMuted = new Set(mutedTracksRef.current)
      nextMuted.add(track.id)
      mutedTracksRef.current = nextMuted
      setMutedTracks(nextMuted)

      midiRenderingTracksRef.current.add(track.id)
      setMidiRenderingTracks(prev => new Set(prev).add(track.id))

      if (playingRef.current) {
        const g = gainsRef.current.get(track.id)
        const ctxNow = actxRef.current
        if (g && ctxNow) {
          const now = ctxNow.currentTime
          g.gain.cancelScheduledValues(now)
          g.gain.setValueAtTime(0, now)
        }
      }

      const trackId = track.id
      void (async () => {
        try {
          const latestForRender = tracksRef.current.find(t => t.id === trackId)
          if (!latestForRender?.midi_data?.notes?.length) {
            midiRenderingTracksRef.current.delete(trackId)
            setMidiRenderingTracks(prev => {
              if (!prev.has(trackId)) return prev
              const next = new Set(prev)
              next.delete(trackId)
              return next
            })
            const nextMuted = new Set(mutedTracksRef.current)
            nextMuted.delete(trackId)
            mutedTracksRef.current = nextMuted
            setMutedTracks(nextMuted)
            resolveMidiRenderWaiters(trackId)
            return
          }
          const buffer = await renderMidiTrackToBuffer(ctx.sampleRate, latestForRender, bpm)
          if (cancelled || !buffer) {
            midiRenderingTracksRef.current.delete(trackId)
            setMidiRenderingTracks(prev => {
              if (!prev.has(trackId)) return prev
              const next = new Set(prev)
              next.delete(trackId)
              return next
            })
            const nextMuted = new Set(mutedTracksRef.current)
            nextMuted.delete(trackId)
            mutedTracksRef.current = nextMuted
            setMutedTracks(nextMuted)
            resolveMidiRenderWaiters(trackId)
            return
          }
          if (midiRenderGenRef.current.get(trackId) !== gen) return
          const latest = tracksRef.current.find(t => t.id === trackId)
          if (!latest?.midi_data?.notes?.length) {
            midiRenderingTracksRef.current.delete(trackId)
            setMidiRenderingTracks(prev => {
              if (!prev.has(trackId)) return prev
              const next = new Set(prev)
              next.delete(trackId)
              return next
            })
            resolveMidiRenderWaiters(trackId)
            return
          }
          const latestKey = midiRenderSourceKey(latest, bpm, timeSig)
          if (latestKey !== renderKey) {
            midiRenderingTracksRef.current.delete(trackId)
            setMidiRenderingTracks(prev => {
              if (!prev.has(trackId)) return prev
              const next = new Set(prev)
              next.delete(trackId)
              return next
            })
            resolveMidiRenderWaiters(trackId)
            return
          }
          finishMidiRenderRef.current(trackId, buffer, latestKey)
        } catch {
          midiRenderingTracksRef.current.delete(trackId)
          setMidiRenderingTracks(prev => {
            if (!prev.has(trackId)) return prev
            const next = new Set(prev)
            next.delete(trackId)
            return next
          })
          const nextMuted = new Set(mutedTracksRef.current)
          nextMuted.delete(trackId)
          mutedTracksRef.current = nextMuted
          setMutedTracks(nextMuted)
          resolveMidiRenderWaiters(trackId)
        }
      })()
    }

    return () => { cancelled = true }
  }, [midiRenderDepsKey, resolveMidiRenderWaiters])

  // Load audio buffers — re-runs when tracks are added/removed within a version.
  useEffect(() => {
    if (!tracks.length) {
      setLoaded(0)
      return
    }

    let cancelled = false
    const ctx = getSharedAudioContext()
    actxRef.current = ctx

    if (!masterGainRef.current) {
      const masterGain = ctx.createGain()
      masterGain.gain.value = volume
      masterGain.connect(getMasterOutput())
      masterGainRef.current = masterGain
      mutedTracksRef.current.add(METRONOME_TRACK_ID)
      setMutedTracks(prev => new Set([...prev, METRONOME_TRACK_ID]))
      setMetronomeOn(false)
    }

    for (const id of [...bufsRef.current.keys()]) {
      if (id === METRONOME_TRACK_ID || id === PREVIEW_MIX_TRACK_ID) continue
      if (!tracksRef.current.some(t => t.id === id)) {
        bufsRef.current.delete(id)
        midiRenderedKeysRef.current.delete(id)
        setMidiPlaybackReadyIds(prev => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        setTrackDurations(prev => {
          if (!prev.has(id)) return prev
          const next = new Map(prev)
          next.delete(id)
          return next
        })
      }
    }

    const pending = audioTracks.filter(t => !bufsRef.current.has(t.id))
    setLoaded(audioTracks.length - pending.length)

    if (pending.length === 0) {
      recomputeTransportDuration()
      markPendingFullMixSwitchIfReady()
      return () => { cancelled = true }
    }

    Promise.all(pending.map(async t => {
      try {
        const ab = await fetchTrackAudioBuffer(t.id)
        if (!ab || cancelled) {
          if (!cancelled) setLoaded(c => c + 1)
          return
        }
        const decoded = await ctx.decodeAudioData(ab)
        if (!cancelled) {
          bufsRef.current.set(t.id, decoded)
          const decodedMs = Math.round(decoded.duration * 1000)
          setTrackDurations(prev => {
            const next = new Map(prev)
            next.set(t.id, decodedMs)
            return next
          })
          setLoaded(c => c + 1)
        }
      } catch {
        if (!cancelled) setLoaded(c => c + 1)
      }
    })).then(() => {
      if (!cancelled) {
        recomputeTransportDuration()
        markPendingFullMixSwitchIfReady()
      }
    })

    return () => { cancelled = true }
  }, [versionId, audioTrackIdsKey, recomputeTransportDuration, volume, markPendingFullMixSwitchIfReady, audioTracks.length])

  // Rehearsal (main only): stream preview MP3 via Audio element (fast canplay),
  // then cache full bytes in the background for the waveform.
  useEffect(() => {
    const r = rehearsalRef.current
    if (!r.enabled || !r.isMainVersion || !r.projectId) {
      clearPreviewMixPlayback()
      return
    }

    let cancelled = false
    const gen = ++previewFetchGenRef.current
    const projectId = r.projectId

    prefetchPreviewMixPlayback(projectId)

    let audio = takePreloadedPreviewAudio(projectId)
    if (!audio) {
      audio = new Audio()
      audio.preload = 'auto'
    }
    previewAudioRef.current = audio

    const markReady = () => {
      if (cancelled || gen !== previewFetchGenRef.current) return
      usingPreviewMixRef.current = true
      soloedTracksRef.current = new Set([PREVIEW_MIX_TRACK_ID])
      setSoloedTracks(new Set([PREVIEW_MIX_TRACK_ID]))
      setPreviewMixReady(true)
      recomputeTransportDuration()
      markPendingFullMixSwitchIfReady()
    }

    const onCanPlay = () => {
      audio!.removeEventListener('canplay', onCanPlay)
      audio!.removeEventListener('error', onError)
      markReady()
    }
    const onError = () => {
      audio!.removeEventListener('canplay', onCanPlay)
      audio!.removeEventListener('error', onError)
      if (!cancelled && gen === previewFetchGenRef.current) clearPreviewMixPlayback()
    }

    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('error', onError)

    const url = previewMixPlaybackUrl(projectId)
    const resolvedUrl = typeof window !== 'undefined' ? new URL(url, window.location.origin).href : url
    if (audio.src !== resolvedUrl) {
      audio.src = url
    } else if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      markReady()
    }

    const onMeta = () => recomputeTransportDuration()
    audio.addEventListener('loadedmetadata', onMeta)

    const ctx = getSharedAudioContext()
    void ensurePreviewMixBuffer(ctx)

    return () => {
      cancelled = true
      audio?.removeEventListener('canplay', onCanPlay)
      audio?.removeEventListener('error', onError)
      audio?.removeEventListener('loadedmetadata', onMeta)
    }
  }, [
    versionId,
    rehearsal.enabled,
    rehearsal.isMainVersion,
    rehearsal.projectId,
    clearPreviewMixPlayback,
    recomputeTransportDuration,
    ensurePreviewMixBuffer,
    markPendingFullMixSwitchIfReady,
  ])

  // Recompute timeline when track offsets/metadata change (without reloading audio)
  useEffect(() => {
    recomputeTransportDuration()
  }, [tracks, recomputeTransportDuration])

  // Hidden metronome track — generated once audio is loaded and timeline length is known.
  const ensureMetronomeBuffer = useCallback((ctx: AudioContext) => {
    const timelineDur = Math.max(
      duration,
      minPlaybackDurationRef.current,
      timelineDurationSecRef.current,
    )
    if (timelineDur <= 0) return
    const proj = projectRef.current
    const bpm = proj?.bpm ?? 120
    const timeSig = proj?.time_signature ?? '4/4'
    const prev = metronomeParamsRef.current
    const existing = bufsRef.current.get(METRONOME_TRACK_ID)
    const needsRegen = !existing
      || !prev
      || prev.bpm !== bpm
      || prev.timeSig !== timeSig
      || existing.duration < timelineDur - 0.05
    if (needsRegen) {
      bufsRef.current.set(
        METRONOME_TRACK_ID,
        generateMetronomeBuffer(ctx, bpm, timeSig, timelineDur),
      )
      metronomeParamsRef.current = { bpm, timeSig, duration: timelineDur }
    }
  }, [duration])

  useEffect(() => {
    const ctx = actxRef.current ?? getSharedAudioContext()
    actxRef.current = ctx
    const tracksReady = audioTracks.length === 0
      || loaded >= audioTracks.length
      || canPlayBeforeTracksLoaded()
    if (!tracksReady) return
    ensureMetronomeBuffer(ctx)
  }, [duration, loaded, audioTracks.length, project?.bpm, project?.time_signature, minPlaybackDuration, timelineDurationSec, ensureMetronomeBuffer, canPlayBeforeTracksLoaded])

  // When the timeline grows during playback (live recording), regenerate the
  // metronome buffer and reschedule its source from the current playhead.
  const prevTimelineDurRef = useRef(timelineDurationSec)
  useEffect(() => {
    const ctx = actxRef.current
    const grew = timelineDurationSec > prevTimelineDurRef.current + 0.05
    prevTimelineDurRef.current = timelineDurationSec
    if (!grew || !playingRef.current || !ctx) return

    ensureMetronomeBuffer(ctx)
    const buf = bufsRef.current.get(METRONOME_TRACK_ID)
    const g = gainsRef.current.get(METRONOME_TRACK_ID)
    if (!buf || !g || !metronomeOnRef.current) return

    const elapsed = ctx.currentTime - startRef.current
    if (elapsed < 0 || elapsed >= buf.duration) return

    if (metronomeSrcRef.current) {
      try { metronomeSrcRef.current.stop() } catch { /* ok */ }
      sourcesRef.current = sourcesRef.current.filter(s => s !== metronomeSrcRef.current)
      metronomeSrcRef.current = null
    }

    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(g)
    src.start(ctx.currentTime, elapsed)
    sourcesRef.current.push(src)
    metronomeSrcRef.current = src
  }, [timelineDurationSec, ensureMetronomeBuffer])

  const stopSourcesImmediate = useCallback(() => {
    countdownCancelRef.current?.()
    countdownCancelRef.current = null
    isCountingRef.current = false

    sourcesRef.current.forEach(s => { try { s.stop() } catch { /* ok */ } })
    sourcesRef.current = []
    metronomeSrcRef.current = null
    previewAudioRef.current?.pause()
    cancelAnimationFrame(rafRef.current)
    gainsRef.current.forEach(g => {
      try { g.disconnect() } catch { /* ok */ }
    })
    gainsRef.current.clear()
    if (masterGainRef.current) {
      try { masterGainRef.current.disconnect() } catch { /* ok */ }
      masterGainRef.current = null
    }
  }, [])

  const stopSources = useCallback(() => {
    const ctx = actxRef.current
    if (ctx && sourcesRef.current.length > 0) {
      const now = ctx.currentTime
      gainsRef.current.forEach(g => {
        try {
          g.gain.cancelScheduledValues(now)
          g.gain.setValueAtTime(g.gain.value, now)
          g.gain.linearRampToValueAtTime(0, now + RAMP_SECS)
        } catch { /* ok */ }
      })
      const toStop = [...sourcesRef.current]
      sourcesRef.current = []
      metronomeSrcRef.current = null
      cancelAnimationFrame(rafRef.current)
      previewAudioRef.current?.pause()
      setTimeout(() => {
        toStop.forEach(s => { try { s.stop() } catch { /* ok */ } })
      }, RAMP_SECS * 1000 + 4)
      return
    }
    stopSourcesImmediate()
  }, [stopSourcesImmediate])

  useEffect(() => {
    const cleanup = () => {
      stopSourcesImmediate()
      setPlaying(false)
      setIsCounting(false)
    }
    const unregister = registerPlaybackStop(cleanup)
    return () => {
      unregister()
      cleanup()
    }
  }, [stopSourcesImmediate])

  const ensurePlaybackGraph = useCallback(() => {
    const ctx = getSharedAudioContext()
    actxRef.current = ctx
    if (!masterGainRef.current || masterGainRef.current.context !== ctx) {
      if (masterGainRef.current) {
        try { masterGainRef.current.disconnect() } catch { /* ok */ }
      }
      const masterGain = ctx.createGain()
      masterGain.gain.value = volume
      masterGain.connect(getMasterOutput())
      masterGainRef.current = masterGain
    }
    return ctx
  }, [volume])

  const play = useCallback(async (
    offset = offsetRef.current,
    tracksOverride?: Track[],
    scheduledStartTime?: number,
  ) => {
    const wasPlaying = playingRef.current
    const trackPlayback = !skipPlaybackAnalyticsRef.current
    skipPlaybackAnalyticsRef.current = false
    stopSources()
    const ctx = ensurePlaybackGraph()
    ensureMetronomeBuffer(ctx)
    if (ctx.state === 'suspended') await ctx.resume()

    if (usingPreviewMixRef.current) {
      await ensurePreviewMixBuffer(ctx)
    }

    const newGains = new Map<string, GainNode>()
    const proj = projectRef.current
    const projBpmP = proj?.bpm ?? 120
    const projBeatsP = parseInt(proj?.time_signature?.split('/')[0] ?? '4') || 4
    const projBarDurSecP = (60 / projBpmP) * projBeatsP
    const allTracks = tracksOverride ?? tracksRef.current
    const trackMetaMap = new Map(allTracks.map(t => [t.id, t]))

    const audioCtxPlayTime = scheduledStartTime != null
      ? Math.max(scheduledStartTime, ctx.currentTime)
      : ctx.currentTime

    bufsRef.current.forEach((buf, id) => {
      const isMetronome = id === METRONOME_TRACK_ID
      const isPreviewMix = id === PREVIEW_MIX_TRACK_ID
      const trackMeta = isMetronome || isPreviewMix ? null : trackMetaMap.get(id)
      if (!isMetronome && !isPreviewMix && !trackMeta) return

      // Edit-mode live preview: schedule the session's bar-aligned buffer
      // slices instead of the whole file at start_bar.
      const editPreview = editPreviewRef.current
      if (editPreview && editPreview.trackId === id) {
        const relevant = editPreview.pieces.filter(p => p.timelineSec + p.durSec > offset)
        if (relevant.length === 0) return
        const g = ctx.createGain()
        const targetGain = effectiveGainForTrack(id, soloedTracksRef.current, mutedTracksRef.current)
        g.gain.setValueAtTime(0, audioCtxPlayTime)
        g.gain.linearRampToValueAtTime(targetGain, audioCtxPlayTime + RAMP_SECS)
        g.connect(masterGainRef.current ?? ctx.destination)
        newGains.set(id, g)
        for (const piece of relevant) {
          const src = ctx.createBufferSource()
          src.buffer = buf
          src.connect(g)
          if (offset <= piece.timelineSec) {
            src.start(audioCtxPlayTime + (piece.timelineSec - offset), piece.srcSec, piece.durSec)
          } else {
            const into = offset - piece.timelineSec
            src.start(audioCtxPlayTime, piece.srcSec + into, piece.durSec - into)
          }
          sourcesRef.current.push(src)
        }
        return
      }

      const trackOffsetSec = (isMetronome || isPreviewMix)
        ? 0
        : (trackMeta!.start_bar ?? trackMeta!.midi_start_bar ?? 0) * projBarDurSecP
      const trackEndSec = trackOffsetSec + buf.duration
      // Skip tracks that end before the playback position
      if (trackEndSec <= offset) return
      const g = ctx.createGain()
      const targetGain = effectiveGainForTrack(id, soloedTracksRef.current, mutedTracksRef.current)
      // Ramp from 0 → target over RAMP_SECS to avoid start-of-playback click
      g.gain.setValueAtTime(0, audioCtxPlayTime)
      g.gain.linearRampToValueAtTime(targetGain, audioCtxPlayTime + RAMP_SECS)
      g.connect(masterGainRef.current ?? ctx.destination)
      newGains.set(id, g)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(g)
      if (offset <= trackOffsetSec) {
        // Playback position is before this track — schedule delayed start
        src.start(audioCtxPlayTime + (trackOffsetSec - offset), 0)
      } else {
        // Playback position is inside this track — start immediately from offset into buffer
        src.start(audioCtxPlayTime, offset - trackOffsetSec)
      }
      sourcesRef.current.push(src)
      if (isMetronome) metronomeSrcRef.current = src
    })
    gainsRef.current = newGains
    startRef.current = audioCtxPlayTime - offset
    offsetRef.current = offset
    setPlaying(true)
    if (trackPlayback && !wasPlaying) trackEvent('playback_started')
    // Track last tick bucket for 5 Hz state throttle (avoids 60fps React re-renders)
    let lastStateTick = -1
    const tick = () => {
      const elapsed = (actxRef.current?.currentTime ?? 0) - startRef.current
      const dur = getTransportDuration() || 1
      currentTimeRef.current = elapsed

      const loop = sectionLoopRef.current
      if (loop) {
        const proj = projectRef.current
        const loopBpm = proj?.bpm ?? 120
        const loopBeats = parseInt(proj?.time_signature?.split('/')[0] ?? '4') || 4
        const loopBarDur = (60 / loopBpm) * loopBeats
        const loopEnd = loop.endBar * loopBarDur
        if (elapsed >= loopEnd - 0.002) {
          skipPlaybackAnalyticsRef.current = true
          void playFnRef.current(loop.startBar * loopBarDur)
          return
        }
      }

      if (elapsed >= dur) { currentTimeRef.current = 0; setPlaying(false); setCurrentTime(0); offsetRef.current = 0; return }
      // Throttle React state to ~5 Hz so text display updates smoothly but cheaply.
      const bucket = Math.floor(elapsed * 5)
      if (bucket !== lastStateTick) {
        lastStateTick = bucket
        setCurrentTime(elapsed)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [getTransportDuration, stopSources, ensurePlaybackGraph, ensureMetronomeBuffer, effectiveGainForTrack, ensurePreviewMixBuffer])

  playFnRef.current = play

  const clearSectionLoop = useCallback(() => {
    sectionLoopRef.current = null
    setSectionLoopOn(false)
  }, [])

  const setSectionLoop = useCallback((range: SectionLoopRange | null) => {
    sectionLoopRef.current = range
    setSectionLoopOn(range !== null)
  }, [])

  const toggleSectionLoop = useCallback((range: SectionLoopRange | null) => {
    if (sectionLoopRef.current) {
      clearSectionLoop()
      return false
    }
    if (!range) return false
    sectionLoopRef.current = range
    setSectionLoopOn(true)
    return true
  }, [clearSectionLoop])

  const pause = useCallback(() => {
    if (isCountingRef.current) {
      isCountingRef.current = false
      setIsCounting(false)
      countdownCancelRef.current?.()
      countdownCancelRef.current = null
      return
    }
    const wasPlaying = playingRef.current
    offsetRef.current = (actxRef.current?.currentTime ?? 0) - startRef.current
    currentTimeRef.current = offsetRef.current
    playingRef.current = false
    stopSources()
    setPlaying(false)
    if (wasPlaying) trackEvent('playback_paused')
    trySwitchToFullMix()
  }, [stopSources, trySwitchToFullMix])

  const seek = useCallback((t: number, tracksOverride?: Track[]) => {
    trackEvent('playback_seeked')
    offsetRef.current = t
    currentTimeRef.current = t
    const loop = sectionLoopRef.current
    if (loop) {
      const proj = projectRef.current
      const barDur = ((60 / (proj?.bpm ?? 120)) * (parseInt(proj?.time_signature?.split('/')[0] ?? '4') || 4))
      const bar = Math.floor(t / barDur)
      if (bar < loop.startBar || bar >= loop.endBar) clearSectionLoop()
    }
    setSeekEpoch(e => e + 1)
    if (playing) play(t, tracksOverride)
    else setCurrentTime(t)
  }, [playing, play, clearSectionLoop])

  const toggleMute = useCallback((id: string) => {
    if (midiRenderingTracksRef.current.has(id)) return
    const next = new Set(mutedTracksRef.current)
    const muting = !next.has(id)
    if (muting) next.add(id)
    else next.delete(id)
    mutedTracksRef.current = next
    setMutedTracks(next)
    if (muting) trackEvent('track_muted')

    const g = gainsRef.current.get(id)
    if (g) {
      const ctx = actxRef.current
      const targetVal = effectiveGainForTrack(id, soloedTracksRef.current, next)
      if (ctx) {
        const now = ctx.currentTime
        g.gain.cancelScheduledValues(now)
        g.gain.setValueAtTime(g.gain.value, now)
        g.gain.linearRampToValueAtTime(targetVal, now + RAMP_SECS)
      } else {
        g.gain.value = targetVal
      }
    }
  }, [effectiveGainForTrack])

  const toggleSolo = useCallback((id: string) => {
    const next = new Set(soloedTracksRef.current)
    const enabling = !next.has(id)
    if (enabling) next.add(id)
    else next.delete(id)
    soloedTracksRef.current = next
    setSoloedTracks(next)
    trackEvent('track_solo_toggled', { enabled: enabling })

    // Soloing one track affects ALL gain nodes — update them all at once.
    gainsRef.current.forEach((g, trackId) => {
      applyGainToTrackNode(trackId, g)
    })
  }, [applyGainToTrackNode])

  const setTrackGain = useCallback((trackId: string, gain: number) => {
    if (midiRenderingTracksRef.current.has(trackId)) return
    const clamped = Math.max(0, Math.min(2, gain))
    const next = new Map(trackGainsRef.current)
    next.set(trackId, clamped)
    trackGainsRef.current = next
    setTrackGainsState(next)
    applyGainToTrackNode(trackId)
  }, [applyGainToTrackNode])

  const setVolume = useCallback((v: number) => {
    setVolumeState(v)
    if (masterGainRef.current) masterGainRef.current.gain.value = v
    if (typeof window !== 'undefined') localStorage.setItem('sonicdesk_volume', String(v))
  }, [])

  // Restore persisted volume after mount — must not read localStorage during SSR init.
  useEffect(() => {
    const saved = parseFloat(localStorage.getItem('sonicdesk_volume') ?? '')
    if (isNaN(saved)) return
    setVolume(Math.max(0, Math.min(1, saved)))
  }, [setVolume])

  const toggleMetronome = useCallback(() => {
    const next = !metronomeOnRef.current
    metronomeOnRef.current = next
    setMetronomeOn(next)
    trackEvent('metronome_toggled', { enabled: next })
    const nextMuted = new Set(mutedTracksRef.current)
    if (next) nextMuted.delete(METRONOME_TRACK_ID)
    else nextMuted.add(METRONOME_TRACK_ID)
    mutedTracksRef.current = nextMuted
    setMutedTracks(nextMuted)
    const g = gainsRef.current.get(METRONOME_TRACK_ID)
    if (g) {
      const ctx = actxRef.current
      const targetVal = next ? 1 : 0
      if (ctx) {
        const now = ctx.currentTime
        g.gain.cancelScheduledValues(now)
        g.gain.setValueAtTime(g.gain.value, now)
        g.gain.linearRampToValueAtTime(targetVal, now + RAMP_SECS)
      } else {
        g.gain.value = targetVal
      }
    }
  }, [])

  const toggleCountdown = useCallback(() => setCountdownOn(c => !c), [])

  const prepareTransport = useCallback(() => {
    const ctx = ensurePlaybackGraph()
    if (ctx.state === 'suspended') void ctx.resume()
    ensureMetronomeBuffer(ctx)
  }, [ensurePlaybackGraph, ensureMetronomeBuffer])

  const snapPlayheadToBar = useCallback((positionSec: number) => {
    const proj = projectRef.current
    const snapped = snapToPreviousBarSec(
      positionSec,
      proj?.bpm ?? 120,
      proj?.time_signature ?? '4/4',
    )
    offsetRef.current = snapped
    currentTimeRef.current = snapped
    setCurrentTime(snapped)
    return snapped
  }, [])

  const playWithCountIn = useCallback(async (offset = offsetRef.current, tracksOverride?: Track[]) => {
    const waitingForTracks = audioTracks.length > 0 && loaded < audioTracks.length
    if (waitingForTracks && !canPlayBeforeTracksLoaded()) return
    if (isCountingRef.current) return

    const snapped = snapPlayheadToBar(offset)

    if (countdownOnRef.current) {
      const ctx = ensurePlaybackGraph()
      const proj = projectRef.current
      if (ctx.state === 'suspended') await ctx.resume()
      isCountingRef.current = true
      setIsCounting(true)
      const out = masterGainRef.current ?? ctx.destination
      const { promise, cancel } = startCountdown(
        ctx,
        out,
        proj?.bpm ?? 120,
        proj?.time_signature ?? '4/4',
      )
      countdownCancelRef.current = cancel
      await promise
      countdownCancelRef.current = null
      if (!isCountingRef.current) return
      setIsCounting(false)
    }
    await play(snapped, tracksOverride)
  }, [play, ensurePlaybackGraph, loaded, audioTracks.length, snapPlayheadToBar, canPlayBeforeTracksLoaded])

  const playbackReady = audioTracks.length === 0
    || loaded >= audioTracks.length
    || canPlayBeforeTracksLoaded()

  const playbackMix: 'preview' | 'full' | 'none' = previewMixReady
    ? 'preview'
    : audioTracks.length > 0
      ? 'full'
      : 'none'

  const waitForMidiRender = useCallback((trackId: string) => {
    const proj = projectRef.current
    const track = tracksRef.current.find(t => t.id === trackId)
    if (!track?.midi_data?.notes?.length) return Promise.resolve()
    const renderKey = midiRenderSourceKey(track, proj?.bpm ?? 120, proj?.time_signature ?? '4/4')
    const ready = midiRenderedKeysRef.current.get(trackId) === renderKey
      && bufsRef.current.has(trackId)
      && !midiRenderingTracksRef.current.has(trackId)
    if (ready) return Promise.resolve()
    return new Promise<void>(resolve => {
      const list = midiRenderWaitersRef.current.get(trackId) ?? []
      list.push(resolve)
      midiRenderWaitersRef.current.set(trackId, list)
    })
  }, [])

  /** Re-fetch + decode one track's audio (after its file was replaced by an edit apply). */
  const reloadTrack = useCallback(async (trackId: string) => {
    bufsRef.current.delete(trackId)
    const ctx = actxRef.current ?? getSharedAudioContext()
    actxRef.current = ctx
    const ab = await fetchTrackAudioBuffer(trackId)
    if (!ab) return
    try {
      const decoded = await ctx.decodeAudioData(ab)
      bufsRef.current.set(trackId, decoded)
      noteTrackDuration(trackId, Math.round(decoded.duration * 1000))
      recomputeTransportDuration()
      if (playingRef.current) {
        skipPlaybackAnalyticsRef.current = true
        void playFnRef.current(offsetRef.current)
      }
    } catch { /* decode failed — track will reload on next version switch */ }
  }, [noteTrackDuration, recomputeTransportDuration])

  // Same bus project tracks use (transport master). Take preview must route here
  // so Vol-adjusted previews match the saved track after Save.
  const getPreviewOutput = useCallback(
    () => masterGainRef.current ?? getMasterOutput(),
    [],
  )

  return {
    playing, currentTime,
    duration: getTransportDuration(),
    loaded, total: audioTracks.length,
    playbackReady,
    playbackMix,
    midiRenderingTracks,
    midiPlaybackReadyIds,
    waitForMidiRender,
    mutedTracks, soloedTracks, trackGains, volume, setVolume,
    play: () => playWithCountIn(),
    playTransport: (scheduledStartTime?: number) => {
      const waitingForTracks = audioTracks.length > 0 && loaded < audioTracks.length
      if (waitingForTracks && !canPlayBeforeTracksLoaded()) return
      const snapped = snapPlayheadToBar(offsetRef.current)
      return play(snapped, undefined, scheduledStartTime)
    },
    prepareTransport,
    playWithCountIn,
    pause, seek, seekEpoch, toggleMute, toggleSolo, setTrackGain,
    metronomeOn, countdownOn, isCounting, toggleMetronome, toggleCountdown,
    sectionLoopOn, toggleSectionLoop, clearSectionLoop, setSectionLoop,
    audioContext: actxRef, trackDurations,
    /** Ref updated every rAF frame. Use for smooth DOM-direct visual updates. */
    currentTimeRef,
    noteTrackDuration,
    setEditPreview,
    reloadTrack,
    getPreviewOutput,
  }
}
