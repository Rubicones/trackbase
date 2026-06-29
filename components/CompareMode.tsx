'use client'

import React, {
  useCallback, useEffect, useRef, useState, useMemo,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import type { Project, Section, Track, Version } from '@/lib/types'
import { waveformBarsCache, fetchTrackAudioBuffer } from '@/lib/waveformCache'
import { getSharedAudioContext, getMasterOutput } from '@/lib/audioContext'
import { renderMidiTrackToBuffer } from '@/lib/midiRender'
import { WaveformBarsPlayhead, playedPctStyle } from '@/components/WaveformBars'
import MiniPianoRoll from '@/components/MiniPianoRoll'
import { trackAccentColor } from '@/lib/trackIcon'
import { HoverTooltip } from '@/components/design/HoverTooltip'
import { transportStatusClass, type TransportStatus } from '@/lib/transportStatus'
import { getVersionDisplayName } from '@/lib/versionSort'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

function sectionLabel(s: Section): string {
  return s.custom_name ?? (s.type.charAt(0).toUpperCase() + s.type.slice(1))
}

/** Bar number (0-indexed) → milliseconds */
function barToMs(bar: number, bpm: number, timeSig: string): number {
  const beatsPerBar = parseInt(timeSig.split('/')[0]) || 4
  return bar * (60000 / bpm) * beatsPerBar
}

function formatSectionOption(s: Section): string {
  return `${sectionLabel(s)} · bars ${s.start_bar + 1}–${s.end_bar}`
}

// ─── Track-comparison analysis ────────────────────────────────────────────────

type CompareStatus = 'identical' | 'changed' | 'only_a' | 'only_b'

interface ComparePair {
  fileName: string       // original upload filename — pairing key
  nameA: string | null   // display label on side A
  nameB: string | null   // display label on side B
  status: CompareStatus
  trackA: Track | null
  trackB: Track | null
}

/** Match key: original file name (not user-editable track label). */
function compareFileKey(t: Track): string {
  return (t.original_filename ?? t.name).toLowerCase()
}

function compareTrackLabel(t: Track): string {
  return t.display_name ?? t.name
}

function buildComparePairs(tracksA: Track[], tracksB: Track[]): ComparePair[] {
  const keysA = tracksA.map(compareFileKey)
  const keysB = tracksB.map(compareFileKey)
  const allKeys = Array.from(new Set([...keysA, ...keysB]))

  return allKeys.map(key => {
    const trackA = tracksA.find(t => compareFileKey(t) === key) ?? null
    const trackB = tracksB.find(t => compareFileKey(t) === key) ?? null
    let status: CompareStatus
    if (trackA && trackB) {
      status = trackA.file_hash === trackB.file_hash ? 'identical' : 'changed'
    } else if (trackA) {
      status = 'only_a'
    } else {
      status = 'only_b'
    }
    const fileName = trackA?.original_filename ?? trackB?.original_filename
      ?? trackA?.name ?? trackB?.name ?? key
    return {
      fileName,
      nameA: trackA ? compareTrackLabel(trackA) : null,
      nameB: trackB ? compareTrackLabel(trackB) : null,
      status,
      trackA,
      trackB,
    }
  }).sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { sensitivity: 'base' }))
}

function comparePairKey(pair: ComparePair): string {
  return `${pair.fileName}-${pair.trackA?.id ?? ''}-${pair.trackB?.id ?? ''}`
}

// ─── useCompareAudio ─────────────────────────────────────────────────────────

type ABMode = 'a' | 'b' | 'both'

interface LoopRange {
  startMs: number
  endMs: number
}

function useCompareAudio(
  tracksA: Track[],
  tracksB: Track[],
  project: Project | null,
) {
  const actxRef = useRef<AudioContext | null>(null)
  const masterGainRef = useRef<GainNode | null>(null)
  const gainARef = useRef<GainNode | null>(null)
  const gainBRef = useRef<GainNode | null>(null)
  const sourcesARef = useRef<AudioBufferSourceNode[]>([])
  const sourcesBRef = useRef<AudioBufferSourceNode[]>([])
  const bufsARef = useRef<Map<string, AudioBuffer>>(new Map())
  const bufsBRef = useRef<Map<string, AudioBuffer>>(new Map())
  const trackGainsARef = useRef<Map<string, GainNode>>(new Map())
  const trackGainsBRef = useRef<Map<string, GainNode>>(new Map())
  const mutedARef = useRef<Set<string>>(new Set())
  const mutedBRef = useRef<Set<string>>(new Set())
  const soloedARef = useRef<Set<string>>(new Set())
  const soloedBRef = useRef<Set<string>>(new Set())

  const startRef = useRef(0)          // audioCtx.currentTime when playback started
  const offsetRef = useRef(0)         // seconds into project when we started
  const rafRef = useRef(0)
  const playingRef = useRef(false)
  const abModeRef = useRef<ABMode>('a')
  const loopRef = useRef<LoopRange | null>(null)
  const volumeRef = useRef(1)
  const playFnRef = useRef<(offsetMs: number) => void>(() => {})

  const volARef = useRef(1)
  const volBRef = useRef(1)

  const [playing, setPlaying] = useState(false)
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const currentTimeMsRef = useRef(0)
  const [abMode, setAbModeState] = useState<ABMode>('a')
  const [volume, setVolumeState] = useState(1)
  const [loadedA, setLoadedA] = useState(0)
  const [loadedB, setLoadedB] = useState(0)
  const [duration, setDuration] = useState(0)
  // Decoded buffer durations (ms) — populated when each buffer finishes decoding
  const [resolvedDurationsA, setResolvedDurationsA] = useState<Map<string, number>>(() => new Map())
  const [resolvedDurationsB, setResolvedDurationsB] = useState<Map<string, number>>(() => new Map())

  // Load buffers for both versions
  useEffect(() => {
    let cancelled = false
    bufsARef.current = new Map()
    bufsBRef.current = new Map()
    setLoadedA(0)
    setLoadedB(0)
    setResolvedDurationsA(new Map())
    setResolvedDurationsB(new Map())
    async function loadSide(
      tracks: Track[],
      bufs: Map<string, AudioBuffer>,
      setLoaded: (n: number) => void,
      setResolvedDurations: React.Dispatch<React.SetStateAction<Map<string, number>>>,
    ) {
      for (const t of tracks) {
        if (cancelled) continue
        try {
          const ctx = getSharedAudioContext()
          let decoded: AudioBuffer | null
          if (t.file_type === 'midi') {
            decoded = await renderMidiTrackToBuffer(ctx.sampleRate, t, project?.bpm ?? 120)
          } else {
            const ab = await fetchTrackAudioBuffer(t.id)
            if (!ab || cancelled) continue
            decoded = await ctx.decodeAudioData(ab)
          }
          if (!decoded || cancelled) continue
          bufs.set(t.id, decoded)
          if (!cancelled) {
            setLoaded(bufs.size)
            // Record decoded duration (ms) — source of truth for waveform sizing
            const durMs = decoded.duration * 1000
            setResolvedDurations(prev => new Map(prev).set(t.id, durMs))
          }
          // Compute waveform bars for non-MIDI tracks only
          if (t.file_type !== 'midi' && !waveformBarsCache.has(t.id)) {
            const raw = decoded.getChannelData(0)
            const N = 96
            const block = Math.floor(raw.length / N)
            const amps: number[] = []
            for (let i = 0; i < N; i++) {
              let s = 0
              for (let j = 0; j < block; j++) s += Math.abs(raw[i * block + j])
              amps.push(s / block)
            }
            const max = Math.max(...amps, 0.001)
            waveformBarsCache.set(t.id, amps.map(a => a / max))
          }
        } catch { /* ignore */ }
      }
      // recompute duration
      if (!cancelled) {
        const proj = project
        if (!proj) return
        const bpm = proj.bpm ?? 120
        const timeSig = proj.time_signature ?? '4/4'
        const beatsPerBar = parseInt(timeSig.split('/')[0]) || 4
        const barDurSec = (60 / bpm) * beatsPerBar
        let maxSec = 0
        for (const [id, buf] of bufsARef.current) {
          const t = tracksA.find(x => x.id === id)
          const startSec = (t?.start_bar ?? 0) * barDurSec
          maxSec = Math.max(maxSec, startSec + buf.duration)
        }
        for (const [id, buf] of bufsBRef.current) {
          const t = tracksB.find(x => x.id === id)
          const startSec = (t?.start_bar ?? 0) * barDurSec
          maxSec = Math.max(maxSec, startSec + buf.duration)
        }
        if (maxSec > 0) setDuration(maxSec * 1000)
      }
    }
    loadSide(tracksA, bufsARef.current, setLoadedA, setResolvedDurationsA)
    loadSide(tracksB, bufsBRef.current, setLoadedB, setResolvedDurationsB)
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tracksA.map(t => t.id).join('|'),
    tracksB.map(t => t.id).join('|'),
  ])

  // Ensure playback graph
  function ensureGraph() {
    const ctx = getSharedAudioContext()
    if (actxRef.current !== ctx || !masterGainRef.current) {
      actxRef.current = ctx
      const master = ctx.createGain()
      master.gain.value = volumeRef.current
      master.connect(getMasterOutput())
      masterGainRef.current = master

      const gA = ctx.createGain()
      gA.gain.value = abModeRef.current !== 'b' ? volARef.current : 0
      gA.connect(master)
      gainARef.current = gA

      const gB = ctx.createGain()
      gB.gain.value = abModeRef.current !== 'a' ? volBRef.current : 0
      gB.connect(master)
      gainBRef.current = gB

      // Reset per-track gains — they were connected to the old nodes
      trackGainsARef.current = new Map()
      trackGainsBRef.current = new Map()
    }
    return actxRef.current!
  }

  function stopSources() {
    sourcesARef.current.forEach(s => { try { s.stop() } catch { /* ok */ } })
    sourcesBRef.current.forEach(s => { try { s.stop() } catch { /* ok */ } })
    sourcesARef.current = []
    sourcesBRef.current = []
    cancelAnimationFrame(rafRef.current)
  }

  const play = useCallback((offsetMs: number) => {
    const ctx = ensureGraph()
    if (ctx.state === 'suspended') void ctx.resume()

    stopSources()
    const offsetSec = offsetMs / 1000
    const proj = project
    const bpm = proj?.bpm ?? 120
    const timeSig = proj?.time_signature ?? '4/4'
    const beatsPerBar = parseInt(timeSig.split('/')[0]) || 4
    const barDurSec = (60 / bpm) * beatsPerBar
    const now = ctx.currentTime

    function scheduleSide(
      bufs: Map<string, AudioBuffer>,
      tracks: Track[],
      gainNode: GainNode,
      sources: AudioBufferSourceNode[],
      trackGains: Map<string, GainNode>,
      mutedSet: Set<string>,
      soloedSet: Set<string>,
    ) {
      const hasSolo = soloedSet.size > 0
      bufs.forEach((buf, id) => {
        const track = tracks.find(t => t.id === id)
        const trackOffsetSec = (track?.start_bar ?? 0) * barDurSec
        const trackEndSec = trackOffsetSec + buf.duration
        if (trackEndSec <= offsetSec) return

        // Get or create per-track gain node
        let tg = trackGains.get(id)
        if (!tg) {
          tg = ctx.createGain()
          tg.connect(gainNode)
          trackGains.set(id, tg)
        }
        const shouldMute = hasSolo ? !soloedSet.has(id) : mutedSet.has(id)
        tg.gain.value = shouldMute ? 0 : 1

        const src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(tg)
        if (offsetSec <= trackOffsetSec) {
          src.start(now + (trackOffsetSec - offsetSec), 0)
        } else {
          src.start(now, offsetSec - trackOffsetSec)
        }
        sources.push(src)
      })
    }

    if (gainARef.current) scheduleSide(bufsARef.current, tracksA, gainARef.current, sourcesARef.current, trackGainsARef.current, mutedARef.current, soloedARef.current)
    if (gainBRef.current) scheduleSide(bufsBRef.current, tracksB, gainBRef.current, sourcesBRef.current, trackGainsBRef.current, mutedBRef.current, soloedBRef.current)

    startRef.current = now - offsetSec
    offsetRef.current = offsetSec
    playingRef.current = true
    setPlaying(true)

    let lastBucket = -1
    const tick = () => {
      const elapsed = ctx.currentTime - startRef.current
      const durSec = Math.max(1, duration / 1000)
      currentTimeMsRef.current = elapsed * 1000

      const loop = loopRef.current
      if (loop) {
        if (elapsed * 1000 >= loop.endMs - 20) {
          playFnRef.current(loop.startMs)
          return
        }
      }

      if (elapsed >= durSec) {
        currentTimeMsRef.current = 0
        setPlaying(false)
        setCurrentTimeMs(0)
        playingRef.current = false
        return
      }
      const bucket = Math.floor(elapsed * 5)
      if (bucket !== lastBucket) {
        lastBucket = bucket
        setCurrentTimeMs(elapsed * 1000)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracksA, tracksB, project, duration])

  playFnRef.current = play

  const pause = useCallback(() => {
    if (!playingRef.current) return
    const elapsed = (actxRef.current?.currentTime ?? 0) - startRef.current
    offsetRef.current = elapsed
    currentTimeMsRef.current = elapsed * 1000
    stopSources()
    setPlaying(false)
    playingRef.current = false
  }, [])

  const seek = useCallback((ms: number) => {
    offsetRef.current = ms / 1000
    currentTimeMsRef.current = ms
    if (playingRef.current) {
      play(ms)
    } else {
      setCurrentTimeMs(ms)
    }
  }, [play])

  const applyGains = useCallback((mode: ABMode, ctx: AudioContext) => {
    const gA = gainARef.current
    const gB = gainBRef.current
    if (!gA || !gB) return
    const now = ctx.currentTime
    const RAMP = 0.05
    const aTarget = mode !== 'b' ? volARef.current : 0
    const bTarget = mode !== 'a' ? volBRef.current : 0
    gA.gain.cancelScheduledValues(now)
    gA.gain.setValueAtTime(gA.gain.value, now)
    gA.gain.linearRampToValueAtTime(aTarget, now + RAMP)
    gB.gain.cancelScheduledValues(now)
    gB.gain.setValueAtTime(gB.gain.value, now)
    gB.gain.linearRampToValueAtTime(bTarget, now + RAMP)
  }, [])

  const setAbMode = useCallback((mode: ABMode) => {
    abModeRef.current = mode
    setAbModeState(mode)
    const ctx = actxRef.current
    if (!ctx) return
    applyGains(mode, ctx)
  }, [applyGains])

  const setSideVolume = useCallback((side: 'a' | 'b', vol: number) => {
    if (side === 'a') volARef.current = vol
    else volBRef.current = vol
    const ctx = actxRef.current
    if (!ctx) return
    applyGains(abModeRef.current, ctx)
  }, [applyGains])

  const setVolume = useCallback((v: number) => {
    volumeRef.current = v
    setVolumeState(v)
    if (masterGainRef.current) masterGainRef.current.gain.value = v
  }, [])

  const setLoop = useCallback((range: LoopRange | null) => {
    loopRef.current = range
  }, [])

  function applyTrackGainStates(
    trackGains: Map<string, GainNode>,
    mutedSet: Set<string>,
    soloedSet: Set<string>,
  ) {
    const hasSolo = soloedSet.size > 0
    for (const [id, tg] of trackGains) {
      const shouldMute = hasSolo ? !soloedSet.has(id) : mutedSet.has(id)
      tg.gain.value = shouldMute ? 0 : 1
    }
  }

  const muteTrack = useCallback((side: 'a' | 'b', trackId: string, muted: boolean) => {
    const muteSet = side === 'a' ? mutedARef.current : mutedBRef.current
    const soloSet = side === 'a' ? soloedARef.current : soloedBRef.current
    const trackGains = side === 'a' ? trackGainsARef.current : trackGainsBRef.current
    if (muted) muteSet.add(trackId)
    else muteSet.delete(trackId)
    applyTrackGainStates(trackGains, muteSet, soloSet)
  }, [])

  const soloTrack = useCallback((side: 'a' | 'b', trackId: string, soloed: boolean) => {
    const muteSet = side === 'a' ? mutedARef.current : mutedBRef.current
    const soloSet = side === 'a' ? soloedARef.current : soloedBRef.current
    const trackGains = side === 'a' ? trackGainsARef.current : trackGainsBRef.current
    if (soloed) soloSet.add(trackId)
    else soloSet.delete(trackId)
    applyTrackGainStates(trackGains, muteSet, soloSet)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSources()
      if (masterGainRef.current) {
        try { masterGainRef.current.disconnect() } catch { /* ok */ }
        masterGainRef.current = null
      }
    }
  }, [])

  return {
    playing, currentTimeMs, currentTimeMsRef,
    duration, loadedA, loadedB,
    totalA: tracksA.length,
    totalB: tracksB.length,
    resolvedDurationsA, resolvedDurationsB,
    abMode, setAbMode,
    volume, setVolume,
    play: () => play(currentTimeMsRef.current),
    pause, seek, setLoop, setSideVolume, muteTrack, soloTrack,
  }
}

// ─── BarRuler ─────────────────────────────────────────────────────────────────

function BarRuler({
  totalDurationMs, barDurationMs,
  currentTimeMsRef, playing, onSeek,
}: {
  totalDurationMs: number
  barDurationMs: number
  currentTimeMsRef: React.RefObject<number>
  playing: boolean
  onSeek: (ms: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)

  // RAF-driven playhead
  useEffect(() => {
    if (!playing) return
    let raf: number
    const tick = () => {
      if (playheadRef.current && totalDurationMs > 0) {
        playheadRef.current.style.left = `${Math.min(100, (currentTimeMsRef.current / totalDurationMs) * 100)}%`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, totalDurationMs, currentTimeMsRef])

  // Static sync when paused
  useEffect(() => {
    if (!playing && playheadRef.current && totalDurationMs > 0) {
      playheadRef.current.style.left = `${Math.min(100, (currentTimeMsRef.current / totalDurationMs) * 100)}%`
    }
  })

  function handleClick(e: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || totalDurationMs <= 0) return
    onSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * totalDurationMs)
  }

  if (totalDurationMs <= 0 || barDurationMs <= 0) return <div className="w-full h-full bg-surface/40" />

  const BARS_PER_TACT = 4
  const totalBars = Math.ceil(totalDurationMs / barDurationMs)
  const tp = (bar: number) => Math.min(100, (bar * barDurationMs / totalDurationMs) * 100)

  // Same density logic as StructureEditor compact mode
  const barGridStep = (() => {
    for (const [max, step] of [[160, 1], [320, 2], [640, 4], [1280, 8], [2560, 16]] as [number, number][]) {
      if (totalBars <= max) return step
    }
    return 32
  })()
  const tactCount = Math.ceil(totalBars / BARS_PER_TACT)
  const tactLabelStep = (() => {
    for (const s of [1, 2, 4, 8, 16, 32, 64]) {
      if (tactCount / s <= 14) return s
    }
    return 64
  })()

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden cursor-pointer bg-surface/40 select-none"
      onClick={handleClick}
    >
      {/* Tact numbers — same style as StructureEditor compact ruler */}
      {Array.from({ length: tactCount }, (_, i) => {
        if (i % tactLabelStep !== 0) return null
        const bar = i * BARS_PER_TACT
        return (
          <span
            key={`tn-${i}`}
            className="absolute top-0.5 text-[9px] tabular-nums font-mono pointer-events-none text-foreground font-medium"
            style={{ left: `${tp(bar)}%`, paddingLeft: i === 0 ? 2 : 4 }}
          >
            {bar + 1}
          </span>
        )
      })}
      {/* Tick marks */}
      {Array.from({ length: Math.ceil(totalBars / barGridStep) + 1 }, (_, idx) => {
        const i = idx * barGridStep
        if (i > totalBars) return null
        const isTact = i % BARS_PER_TACT === 0
        return (
          <div
            key={`rt-${i}`}
            className="absolute bottom-0 w-px pointer-events-none"
            style={{
              left: `${tp(i)}%`,
              height: isTact ? 10 : 5,
              background: isTact
                ? 'color-mix(in oklab, var(--foreground) 45%, transparent)'
                : 'var(--border)',
            }}
          />
        )
      })}
      {/* Playhead */}
      <div
        ref={playheadRef}
        className="absolute top-0 bottom-0 w-px bg-foreground/70 pointer-events-none"
        style={{ left: '0%' }}
      />
    </div>
  )
}

// ─── WaveformCell ─────────────────────────────────────────────────────────────

function WaveformCell({
  trackId,
  color,
  startBar,
  trackDurationMs,
  totalDurationMs,
  barDurationMs,
  currentTimeMsRef,
  playing,
  absent,
}: {
  trackId: string | null
  color: string
  startBar: number
  trackDurationMs: number   // content duration of this track (not including start_bar offset)
  totalDurationMs: number
  barDurationMs: number
  currentTimeMsRef: React.RefObject<number>
  playing: boolean
  absent?: boolean
}) {
  const bars = trackId ? (waveformBarsCache.get(trackId) ?? []) : []
  const cellRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)

  const startBarMs = startBar * barDurationMs
  const clampedDuration = Math.max(1, trackDurationMs)

  // Update --played-pct relative to this track's own duration
  useEffect(() => {
    if (!playing) return
    const tick = () => {
      const el = cellRef.current
      if (!el) return
      const elapsed = currentTimeMsRef.current
      const pct = Math.min(100, Math.max(0, (elapsed - startBarMs) / clampedDuration * 100))
      el.style.setProperty('--played-pct', `${pct}%`)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, startBarMs, clampedDuration, currentTimeMsRef])

  // Sync static position when paused
  useEffect(() => {
    if (playing) return
    const el = cellRef.current
    if (!el) return
    const pct = Math.min(100, Math.max(0, (currentTimeMsRef.current - startBarMs) / clampedDuration * 100))
    el.style.setProperty('--played-pct', `${pct}%`)
  })

  // Clamp offset to ≥ 0 (tracks with negative start_bar, e.g. pre-roll, must not overflow left)
  const offsetPct = totalDurationMs > 0 ? Math.max(0, (startBarMs / totalDurationMs) * 100) : 0
  // Width is the lesser of: track duration or remaining space from offsetPct
  const widthPct  = totalDurationMs > 0 ? Math.min(
    (clampedDuration / totalDurationMs) * 100,
    100 - offsetPct,
  ) : 100

  if (absent) {
    return (
      <div
        className="flex-1 min-w-0 relative flex items-center justify-center"
        style={{ background: 'repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(128,128,128,0.06) 6px, rgba(128,128,128,0.06) 12px)' }}
      >
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground/60">
          — Not present in this version —
        </span>
      </div>
    )
  }

  if (!bars.length) {
    return (
      <div className="flex-1 min-w-0 relative flex items-center justify-end pr-3">
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground/40">Loading…</span>
      </div>
    )
  }

  return (
    <div
      ref={cellRef}
      className="flex-1 min-w-0 relative overflow-hidden"
      style={playedPctStyle(0)}
    >
      <div
        className="absolute inset-y-2"
        style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
      >
        <WaveformBarsPlayhead
          bars={bars}
          color={color}
          ready
          className="h-full"
          animate={false}
        />
      </div>
    </div>
  )
}

// ─── CompareTrackRow ──────────────────────────────────────────────────────────

function MuteSoloButtons({
  muted, soloed, onMute, onSolo, accentColor,
}: {
  muted: boolean; soloed: boolean
  onMute: () => void; onSolo: () => void
  accentColor: string   // CSS color value (var(--lime) for A, dynamic for B)
}) {
  return (
    <div className="shrink-0 flex flex-col gap-px justify-center px-1" style={{ width: 28 }}>
      <button
        type="button"
        title={muted ? 'Unmute' : 'Mute'}
        onClick={onMute}
        className="text-[8px] font-bold px-0.5 py-0.5 leading-none transition"
        style={muted ? { background: '#ef4444', color: '#fff' } : { color: 'rgba(128,128,128,0.5)' }}
      >
        M
      </button>
      <button
        type="button"
        title={soloed ? 'Unsolo' : 'Solo'}
        onClick={onSolo}
        className="text-[8px] font-bold px-0.5 py-0.5 leading-none transition"
        style={soloed
          ? { background: accentColor, color: 'var(--primary-foreground, #fff)' }
          : { color: 'rgba(128,128,128,0.5)' }
        }
      >
        S
      </button>
    </div>
  )
}

function TrackVisual({
  track,
  color,
  totalDurationMs,
  barDurationMs,
  currentTimeMsRef,
  playing,
  absent,
  resolvedDurationMs,
  projectBpm,
}: {
  track: Track | null
  color: string
  totalDurationMs: number
  barDurationMs: number
  currentTimeMsRef: React.RefObject<number>
  playing: boolean
  absent?: boolean
  resolvedDurationMs: number
  projectBpm: number
}) {
  if (absent || !track) {
    return (
      <div
        className="flex-1 min-w-0 relative flex items-center justify-center"
        style={{ background: 'repeating-linear-gradient(-45deg, transparent, transparent 6px, rgba(128,128,128,0.06) 6px, rgba(128,128,128,0.06) 12px)' }}
      >
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground/60">
          — Not present in this version —
        </span>
      </div>
    )
  }

  if (track.file_type === 'midi' && track.midi_data) {
    // MiniPianoRoll maps notes directly onto the full project timeline
    // (it uses midiStartBar + totalProjectMs to position notes absolutely),
    // so it fills the full column width — no spacer needed.
    return (
      <div className="flex-1 min-w-0 relative overflow-hidden flex items-center">
        <MiniPianoRoll
          midiData={track.midi_data}
          color={color}
          projectBpm={projectBpm}
          totalProjectMs={totalDurationMs}
          midiStartBar={track.start_bar ?? 0}
          height={40}
        />
      </div>
    )
  }

  return (
    <WaveformCell
      trackId={track.id}
      color={color}
      startBar={track.start_bar ?? 0}
      trackDurationMs={resolvedDurationMs}
      totalDurationMs={totalDurationMs}
      barDurationMs={barDurationMs}
      currentTimeMsRef={currentTimeMsRef}
      playing={playing}
      absent={false}
    />
  )
}

function ComparePairLabel({
  pair,
  bColor,
}: {
  pair: ComparePair
  bColor: string
}) {
  const namesDiffer = pair.nameA && pair.nameB && pair.nameA !== pair.nameB

  if (namesDiffer) {
    return (
      <div className="flex flex-col gap-0.5 min-w-0">
        <span
          className="text-[11px] font-medium truncate uppercase tracking-wide"
          style={{ color: 'var(--lime)' }}
          title={pair.nameA!}
        >
          {pair.nameA}
        </span>
        <span
          className="text-[11px] font-medium truncate uppercase tracking-wide"
          style={{ color: bColor }}
          title={pair.nameB!}
        >
          {pair.nameB}
        </span>
      </div>
    )
  }

  const singleName = pair.nameA ?? pair.nameB ?? pair.fileName
  const sideColor = pair.status === 'only_b' ? bColor : pair.status === 'only_a' ? 'var(--lime)' : undefined

  return (
    <span
      className="text-[11px] font-medium truncate uppercase tracking-wide"
      style={sideColor ? { color: sideColor } : { color: 'var(--foreground)' }}
      title={singleName}
    >
      {singleName}
    </span>
  )
}

function CompareTrackRow({
  pair, index,
  totalDurationMs, barDurationMs,
  currentTimeMsRef, playing,
  mutedA, mutedB, soloedA, soloedB,
  onMuteA, onMuteB, onSoloA, onSoloB,
  bColor,
  resolvedDurationsA, resolvedDurationsB,
  projectBpm,
}: {
  pair: ComparePair
  index: number
  totalDurationMs: number
  barDurationMs: number
  currentTimeMsRef: React.RefObject<number>
  playing: boolean
  mutedA: boolean; mutedB: boolean
  soloedA: boolean; soloedB: boolean
  onMuteA: () => void; onMuteB: () => void
  onSoloA: () => void; onSoloB: () => void
  bColor: string
  resolvedDurationsA: Map<string, number>
  resolvedDurationsB: Map<string, number>
  projectBpm: number
}) {
  const colorA = trackAccentColor(pair.trackA?.icon_color ?? null, index)
  const colorB = trackAccentColor(pair.trackB?.icon_color ?? null, index)

  // Use decoded buffer duration; fall back to barDurationMs * remaining bars
  const durA = pair.trackA
    ? (resolvedDurationsA.get(pair.trackA.id) ?? Math.max(0, totalDurationMs - Math.max(0, pair.trackA.start_bar ?? 0) * barDurationMs))
    : 0
  const durB = pair.trackB
    ? (resolvedDurationsB.get(pair.trackB.id) ?? Math.max(0, totalDurationMs - Math.max(0, pair.trackB.start_bar ?? 0) * barDurationMs))
    : 0

  const statusLabel: Record<CompareStatus, string> = {
    identical: 'Identical',
    changed: 'Changed',
    only_a: 'Only in A',
    only_b: 'Only in B',
  }

  return (
    <div className="flex border-b border-border" style={{ minHeight: 56 }}>
      {/* Label col */}
      <div
        className="shrink-0 border-r border-border px-3 flex flex-col justify-center gap-0.5 bg-surface/40"
        style={{ width: 140 }}
      >
        <ComparePairLabel pair={pair} bColor={bColor} />
        <span
          className="text-[9px] uppercase tracking-widest font-bold"
          style={{
            color: pair.status === 'identical' ? 'var(--text-muted)'
                 : pair.status === 'changed'   ? '#facc15'
                 : pair.status === 'only_a'    ? 'var(--lime)'
                 : bColor
          }}
        >
          {pair.status === 'changed' ? '● Changed' : statusLabel[pair.status]}
        </span>
      </div>

      {/* Side A: M/S + visual */}
      {pair.trackA ? (
        <MuteSoloButtons
          muted={mutedA} soloed={soloedA}
          onMute={onMuteA} onSolo={onSoloA}
          accentColor="var(--lime)"
        />
      ) : (
        <div className="shrink-0" style={{ width: 28 }} />
      )}
      <TrackVisual
        track={pair.trackA}
        color={colorA}
        totalDurationMs={totalDurationMs}
        barDurationMs={barDurationMs}
        currentTimeMsRef={currentTimeMsRef}
        playing={playing}
        absent={!pair.trackA}
        resolvedDurationMs={durA}
        projectBpm={projectBpm}
      />

      {/* Divider */}
      <div className="w-px bg-border/60 shrink-0" />

      {/* Side B: M/S + visual */}
      {pair.trackB ? (
        <MuteSoloButtons
          muted={mutedB} soloed={soloedB}
          onMute={onMuteB} onSolo={onSoloB}
          accentColor={bColor}
        />
      ) : (
        <div className="shrink-0" style={{ width: 28 }} />
      )}
      <TrackVisual
        track={pair.trackB}
        color={colorB}
        totalDurationMs={totalDurationMs}
        barDurationMs={barDurationMs}
        currentTimeMsRef={currentTimeMsRef}
        playing={playing}
        absent={!pair.trackB}
        resolvedDurationMs={durB}
        projectBpm={projectBpm}
      />
    </div>
  )
}

// ─── Compare-side status tag ──────────────────────────────────────────────────

function resolveCompareSideStatus({
  loaded, total, isAudible, playing, loopOn, activeSectionLabel,
}: {
  loaded: number
  total: number
  isAudible: boolean    // false when abMode silences this side
  playing: boolean
  loopOn: boolean
  activeSectionLabel?: string
}): TransportStatus {
  const allLoaded = total === 0 || loaded >= total

  if (!allLoaded) {
    return { label: `loading ${loaded}/${total}`, tone: 'muted' }
  }

  if (!isAudible) {
    return { label: playing ? 'playing · muted' : 'muted', tone: 'muted' }
  }

  if (playing) {
    const sectionPart = loopOn && activeSectionLabel ? ` · ${activeSectionLabel.toLowerCase()}` : ''
    return { label: `playing${sectionPart}`, tone: 'accent' }
  }

  return { label: 'ready', tone: 'muted' }
}

// ─── VersionSideHeader ────────────────────────────────────────────────────────

function VersionSideHeader({
  side,
  versions,
  selectedId,
  onSelect,
  volume,
  onVolume,
  isAudible,
  playing,
  loaded,
  total,
  loopOn,
  activeSectionLabel,
  onUseAsMaster,
  bColor,
}: {
  side: 'A' | 'B'
  versions: Version[]
  selectedId: string
  onSelect: (id: string) => void
  volume: number
  onVolume: (v: number) => void
  isAudible: boolean
  playing: boolean
  loaded: number
  total: number
  loopOn: boolean
  activeSectionLabel?: string
  onUseAsMaster: () => void
  bColor: string
}) {
  const isA = side === 'A'
  const accentColor = isA ? 'var(--lime)' : bColor

  const sideStatus = resolveCompareSideStatus({
    loaded, total, isAudible, playing, loopOn, activeSectionLabel,
  })
  const statusClass = transportStatusClass(sideStatus)

  return (
    <div
      className="border-b border-border px-4 py-2 flex flex-col gap-2"
      style={{ background: isA ? 'color-mix(in oklch, var(--lime) 8%, transparent)' : `color-mix(in oklch, ${bColor} 8%, transparent)` }}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: accentColor }}
        />
        <span className="text-[9px] uppercase tracking-widest font-bold text-muted-foreground shrink-0">
          Side {side}
        </span>
        {/* Status tag — B side playing overrides lime→bColor */}
        <span
          className={statusClass}
          style={sideStatus.tone === 'accent' && !isA
            ? { borderColor: bColor, color: bColor }
            : undefined
          }
        >
          {sideStatus.label}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={selectedId}
            onChange={e => onSelect(e.target.value)}
            className="text-[10px] uppercase tracking-widest bg-background border border-border text-foreground px-2 py-0.5 focus:outline-none focus:border-lime cursor-pointer max-w-[160px]"
          >
            {versions.map(v => (
              <option key={v.id} value={v.id}>
                {getVersionDisplayName(v)}{v.type === 'main' ? ' (Master)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground shrink-0">Vol</span>
        <input
          type="range"
          min={0} max={1} step={0.01}
          value={volume}
          onChange={e => onVolume(parseFloat(e.target.value))}
          className="flex-1 h-1 cursor-pointer"
          style={{ accentColor }}
        />
        <span className="text-[9px] text-muted-foreground tabular-nums w-6">{Math.round(volume * 100)}</span>
        <button
          type="button"
          onClick={onUseAsMaster}
          className="text-[9px] uppercase tracking-widest px-2 py-1 border hover:opacity-90 transition shrink-0 text-primary-foreground"
          style={{ borderColor: accentColor, background: accentColor }}
        >
          Use this
        </button>
      </div>
    </div>
  )
}

// ─── LoopSectionSelector ──────────────────────────────────────────────────────

function LoopSectionSelector({
  side,
  sections,
  selectedId,
  onSelect,
  isSource,
  bColor,
}: {
  side: 'A' | 'B'
  sections: Section[]
  selectedId: string | null
  onSelect: (sectionId: string | null) => void
  isSource: boolean
  bColor: string
}) {
  const isA = side === 'A'
  const accentColor = isA ? 'var(--lime)' : bColor

  if (sections.length === 0) {
    return (
      <div className="flex items-center gap-1.5 opacity-40">
        <span className="text-[9px] uppercase tracking-widest" style={{ color: accentColor }}>
          {side}
        </span>
        <span className="text-[9px] text-muted-foreground italic">No sections</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] uppercase tracking-widest font-bold" style={{ color: accentColor }}>
        {side}{isSource ? ' ●' : ''}
      </span>
      <select
        value={selectedId ?? ''}
        onChange={e => onSelect(e.target.value || null)}
        className="text-[9px] uppercase tracking-widest bg-background px-1.5 py-0.5 focus:outline-none cursor-pointer border text-foreground"
        style={{ borderColor: isSource ? accentColor : undefined }}
      >
        <option value="">— select section —</option>
        {sections.map(s => (
          <option key={s.id} value={s.id}>
            {formatSectionOption(s)}
          </option>
        ))}
      </select>
    </div>
  )
}

// ─── CompareTransportBar ──────────────────────────────────────────────────────

function CompareTransportBar({
  playing, currentTimeMs, duration,
  onPlay, onPause, onSeek,
  abMode, versionA, versionB,
}: {
  playing: boolean
  currentTimeMs: number
  duration: number
  onPlay: () => void
  onPause: () => void
  onSeek: (ms: number) => void
  abMode: ABMode
  versionA: Version | undefined
  versionB: Version | undefined
}) {
  const seekRef = useRef<HTMLDivElement>(null)
  const currentSec = currentTimeMs / 1000
  const durationSec = duration / 1000
  const pct = duration > 0 ? Math.min(100, (currentTimeMs / duration) * 100) : 0

  function handleSeekClick(e: React.MouseEvent) {
    const rect = seekRef.current?.getBoundingClientRect()
    if (!rect) return
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onSeek(frac * duration)
  }

  const listeningLabel = abMode === 'both'
    ? 'Sync'
    : abMode === 'a'
      ? `A · ${versionA ? getVersionDisplayName(versionA) : ''}`
      : `B · ${versionB ? getVersionDisplayName(versionB) : ''}`

  return (
    <div className="border-t border-border bg-background flex items-center gap-3 px-4 py-2 shrink-0">
      {/* Play/Pause */}
      <button
        type="button"
        onClick={playing ? onPause : onPlay}
        className="size-7 border border-border text-foreground hover:border-lime hover:text-lime transition grid place-items-center shrink-0"
      >
        {playing ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <rect x="1.5" y="1.5" width="2.5" height="7" />
            <rect x="6" y="1.5" width="2.5" height="7" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M2 1.5l7 3.5-7 3.5z" />
          </svg>
        )}
      </button>

      {/* Time display */}
      <span className="text-[10px] tabular-nums font-mono text-muted-foreground w-12 shrink-0">
        {fmtTime(currentSec)}
      </span>

      {/* Seek bar */}
      <div
        ref={seekRef}
        onClick={handleSeekClick}
        className="flex-1 h-1 bg-border relative cursor-pointer group"
      >
        <div
          className="absolute left-0 top-0 h-full bg-lime transition-none"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-foreground border border-background opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `${pct}%` }}
        />
      </div>

      {/* Duration */}
      <span className="text-[10px] tabular-nums font-mono text-muted-foreground w-12 shrink-0 text-right">
        {fmtTime(durationSec)}
      </span>

      {/* Listening indicator */}
      <span className="text-[9px] uppercase tracking-widest text-muted-foreground shrink-0">
        Playing: <span className="text-foreground">{listeningLabel}</span>
      </span>
    </div>
  )
}

// ─── CompareMode ──────────────────────────────────────────────────────────────

export default function CompareMode({
  project,
  versions,
  initialVersionAId,
  initialVersionBId,
  onExit,
  onSetMaster,
  transportSlot,
}: {
  project: Project
  versions: Version[]
  initialVersionAId: string
  initialVersionBId: string
  onExit: () => void
  onSetMaster: (versionId: string) => void
  /** Portal target for the transport bar (page-level div, same position as MasterPlayerBar) */
  transportSlot?: HTMLElement | null
}) {
  // ── Version selection ──────────────────────────────────────────────────────
  const [versionAId, setVersionAId] = useState(initialVersionAId)
  const [versionBId, setVersionBId] = useState(initialVersionBId)
  const versionA = versions.find(v => v.id === versionAId)
  const versionB = versions.find(v => v.id === versionBId)
  const tracksA = versionA?.tracks ?? []
  const tracksB = versionB?.tracks ?? []

  // ── Sections for each version ──────────────────────────────────────────────
  const [sectionsA, setSectionsA] = useState<Section[]>([])
  const [sectionsB, setSectionsB] = useState<Section[]>([])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/versions/${versionAId}/sections`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setSectionsA(d.sections ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [versionAId])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/versions/${versionBId}/sections`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setSectionsB(d.sections ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [versionBId])

  // ── Audio ──────────────────────────────────────────────────────────────────
  const audio = useCompareAudio(tracksA, tracksB, project)

  // Spacebar play/pause (compare mode owns this while active)
  const audioRef = useRef(audio)
  audioRef.current = audio
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space') return
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return
      e.preventDefault()
      if (audioRef.current.playing) audioRef.current.pause()
      else audioRef.current.play()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ── Per-side volume ────────────────────────────────────────────────────────
  const [volA, setVolA] = useState(1)
  const [volB, setVolB] = useState(1)

  // ── Per-track mute/solo ────────────────────────────────────────────────────
  const [mutedTracksA, setMutedTracksA] = useState<Set<string>>(new Set())
  const [mutedTracksB, setMutedTracksB] = useState<Set<string>>(new Set())
  const [soloedTracksA, setSoloedTracksA] = useState<Set<string>>(new Set())
  const [soloedTracksB, setSoloedTracksB] = useState<Set<string>>(new Set())

  function toggleMuteA(trackId: string) {
    setMutedTracksA(prev => {
      const next = new Set(prev)
      const nowMuted = !next.has(trackId)
      if (nowMuted) next.add(trackId); else next.delete(trackId)
      audio.muteTrack('a', trackId, nowMuted)
      return next
    })
  }
  function toggleMuteB(trackId: string) {
    setMutedTracksB(prev => {
      const next = new Set(prev)
      const nowMuted = !next.has(trackId)
      if (nowMuted) next.add(trackId); else next.delete(trackId)
      audio.muteTrack('b', trackId, nowMuted)
      return next
    })
  }
  function toggleSoloA(trackId: string) {
    setSoloedTracksA(prev => {
      const next = new Set(prev)
      const nowSoloed = !next.has(trackId)
      if (nowSoloed) next.add(trackId); else next.delete(trackId)
      audio.soloTrack('a', trackId, nowSoloed)
      return next
    })
  }
  function toggleSoloB(trackId: string) {
    setSoloedTracksB(prev => {
      const next = new Set(prev)
      const nowSoloed = !next.has(trackId)
      if (nowSoloed) next.add(trackId); else next.delete(trackId)
      audio.soloTrack('b', trackId, nowSoloed)
      return next
    })
  }

  // ── Loop ──────────────────────────────────────────────────────────────────
  const [loopOn, setLoopOn] = useState(false)
  const [loopSource, setLoopSource] = useState<'a' | 'b'>('a')
  const [loopSectionIdA, setLoopSectionIdA] = useState<string | null>(null)
  const [loopSectionIdB, setLoopSectionIdB] = useState<string | null>(null)

  const bpm = project.bpm ?? 120
  const timeSig = project.time_signature ?? '4/4'
  const beatsPerBar = parseInt(timeSig.split('/')[0]) || 4
  const barDurationMs = (60000 / bpm) * beatsPerBar

  // ── Theme-aware B side color ───────────────────────────────────────────────
  // In studio-paper-dark / studio-light, --lime is indigo so violet would look identical.
  // Use bright lime (#dfff00) for B in those themes to maintain contrast.
  const [isStudioPaper, setIsStudioPaper] = useState(() => {
    if (typeof document === 'undefined') return false
    const t = document.documentElement.getAttribute('data-theme')
    return t === 'studio-paper-dark' || t === 'studio-light'
  })
  useEffect(() => {
    const update = () => {
      const t = document.documentElement.getAttribute('data-theme')
      setIsStudioPaper(t === 'studio-paper-dark' || t === 'studio-light')
    }
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  // B-side accent values (raw color, soft overlay, border, text)
  const bColor     = isStudioPaper ? '#dfff00' : '#7c3aed'
  const bColorSoft = isStudioPaper ? 'rgba(223,255,0,0.18)' : 'rgba(124,58,237,0.18)'
  const bColorBorder = isStudioPaper ? 'rgba(223,255,0,0.6)' : 'rgba(124,58,237,0.6)'
  const bColorText = isStudioPaper ? '#dfff00' : '#a78bfa'

  // Compute loop range from current selection
  const loopRange = useMemo<LoopRange | null>(() => {
    if (!loopOn) return null
    const sectionId = loopSource === 'a' ? loopSectionIdA : loopSectionIdB
    const sections = loopSource === 'a' ? sectionsA : sectionsB
    const sec = sections.find(s => s.id === sectionId)
    if (!sec) return null
    return {
      startMs: barToMs(sec.start_bar, bpm, timeSig),
      endMs: barToMs(sec.end_bar, bpm, timeSig),
    }
  }, [loopOn, loopSource, loopSectionIdA, loopSectionIdB, sectionsA, sectionsB, bpm, timeSig])

  // Push loop range into audio engine whenever it changes
  useEffect(() => {
    audio.setLoop(loopRange)
  }, [loopRange, audio.setLoop])

  // When a section is selected from either selector, activate loop + set source.
  // Only one section can be active at a time — selecting from one side clears the other.
  function handleSelectSectionA(id: string | null) {
    setLoopSectionIdA(id)
    if (id) {
      setLoopSectionIdB(null)   // deselect B
      setLoopSource('a')
      setLoopOn(true)
    } else {
      setLoopOn(false)
    }
  }

  function handleSelectSectionB(id: string | null) {
    setLoopSectionIdB(id)
    if (id) {
      setLoopSectionIdA(null)   // deselect A
      setLoopSource('b')
      setLoopOn(true)
    } else {
      setLoopOn(false)
    }
  }

  function toggleLoop() {
    const next = !loopOn
    setLoopOn(next)
    if (!next) {
      setLoopSectionIdA(null)
      setLoopSectionIdB(null)
    }
  }

  // ── A/B mode ───────────────────────────────────────────────────────────────
  function handleAbMode(mode: ABMode) {
    audio.setAbMode(mode)
  }

  // ── Track pairs ────────────────────────────────────────────────────────────
  const pairs = useMemo(() => buildComparePairs(tracksA, tracksB), [tracksA, tracksB])

  // ── Comments for both versions ─────────────────────────────────────────────
  const commentsA = tracksA.flatMap(t => (t.comments ?? []).map(c => ({ ...c, versionName: versionA ? getVersionDisplayName(versionA) : 'A' })))
  const commentsB = tracksB.flatMap(t => (t.comments ?? []).map(c => ({ ...c, versionName: versionB ? getVersionDisplayName(versionB) : 'B' })))

  // ── Project timing ─────────────────────────────────────────────────────────
  const totalDurationMs = audio.duration || 1

  // ── Structure: sections as ribbons with playhead ─────────────────────────
  function SectionRibbon({
    sections, side, bSectionBg, bSectionBorder, bSectionText,
  }: {
    sections: Section[]
    side: 'A' | 'B'
    bSectionBg: string
    bSectionBorder: string
    bSectionText: string
  }) {
    const isA = side === 'A'
    const ribbonRef = useRef<HTMLDivElement>(null)
    const sPlayheadRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      if (!audio.playing) return
      let raf: number
      const tick = () => {
        if (sPlayheadRef.current && totalDurationMs > 0) {
          sPlayheadRef.current.style.left = `${Math.min(100, (audio.currentTimeMsRef.current / totalDurationMs) * 100)}%`
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    }, [audio.playing])

    useEffect(() => {
      if (!audio.playing && sPlayheadRef.current && totalDurationMs > 0) {
        sPlayheadRef.current.style.left = `${Math.min(100, (audio.currentTimeMsRef.current / totalDurationMs) * 100)}%`
      }
    })

    function handleClick(e: React.MouseEvent) {
      const rect = ribbonRef.current?.getBoundingClientRect()
      if (!rect || totalDurationMs <= 0) return
      audio.seek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * totalDurationMs)
    }

    return (
      <div
        ref={ribbonRef}
        className="flex-1 relative overflow-hidden cursor-pointer"
        style={{ height: 22, background: 'var(--bg-surface)' }}
        onClick={handleClick}
      >
        {!sections.length && <div className="absolute inset-0 bg-surface/20" />}
        {sections.map(s => {
          const leftPct = totalDurationMs > 0 ? (barToMs(s.start_bar, bpm, timeSig) / totalDurationMs) * 100 : 0
          const rightPct = totalDurationMs > 0 ? 100 - (barToMs(s.end_bar, bpm, timeSig) / totalDurationMs) * 100 : 100
          return (
            <div
              key={s.id}
              className="absolute inset-y-0 flex items-center px-1.5 overflow-hidden"
              style={{
                left: `${leftPct}%`,
                right: `${Math.max(0, rightPct)}%`,
                background: isA ? 'var(--lime-soft)' : bSectionBg,
                borderLeft: isA ? '1px solid color-mix(in oklch, var(--lime) 60%, transparent)' : bSectionBorder,
                borderRight: '1px solid var(--background)',
              }}
            >
              <span
                className="text-[8px] uppercase tracking-widest font-bold whitespace-nowrap overflow-hidden text-ellipsis"
                style={{ color: isA ? 'var(--lime)' : bSectionText }}
              >
                {sectionLabel(s)}
              </span>
            </div>
          )
        })}
        {/* Playhead */}
        <div
          ref={sPlayheadRef}
          className="absolute top-0 bottom-0 w-px bg-foreground/70 pointer-events-none"
          style={{ left: '0%' }}
        />
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
    <div className="flex flex-col flex-1 overflow-hidden bg-background">

      {/* A/B Compare bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-surface/40 shrink-0 flex-wrap">
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold shrink-0">
          // A/B Compare
        </span>

        {/* A/B/Both tabs */}
        <div className="flex border border-border shrink-0">
          {(['a', 'both', 'b'] as const).map((mode, i) => {
            const label = mode === 'both' ? 'Sync' : mode.toUpperCase()
            const isActive = audio.abMode === mode
            return (
              <button
                key={mode}
                type="button"
                onClick={() => handleAbMode(mode)}
                className={`text-[9px] uppercase tracking-widest px-2.5 py-1 transition border-r last:border-r-0 border-border ${
                  isActive
                    ? mode === 'a'
                      ? 'bg-lime text-primary-foreground'
                      : mode === 'both'
                        ? 'bg-foreground text-background'
                        : ''
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                style={isActive && mode === 'b' ? { background: bColor, color: 'var(--primary-foreground, #fff)' } : undefined}
              >
                {label === 'Sync' ? (
                  <span className="flex items-center gap-1">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M1 5h8M5 1l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Sync play
                  </span>
                ) : label}
              </button>
            )
          })}
        </div>

        {/* Loop toggle */}
        <button
          type="button"
          onClick={toggleLoop}
          className={`text-[9px] uppercase tracking-widest px-2.5 py-1 border transition shrink-0 ${
            loopOn
              ? 'border-lime text-lime bg-lime-soft'
              : 'border-border text-muted-foreground hover:border-lime hover:text-lime'
          }`}
        >
          Loop {loopOn ? 'On' : 'Off'}
        </button>

        {/* Loop section selectors — only when loop is on */}
        {loopOn && (
          <div className="flex items-center gap-3 flex-wrap">
            <LoopSectionSelector
              side="A"
              sections={sectionsA}
              selectedId={loopSectionIdA}
              onSelect={handleSelectSectionA}
              isSource={loopSource === 'a'}
              bColor={bColor}
            />
            <LoopSectionSelector
              side="B"
              sections={sectionsB}
              selectedId={loopSectionIdB}
              onSelect={handleSelectSectionB}
              isSource={loopSource === 'b'}
              bColor={bColor}
            />
          </div>
        )}

        {/* Loop range indicator */}
        {loopOn && loopRange && (
          <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">
            {fmtTime(loopRange.startMs / 1000)} – {fmtTime(loopRange.endMs / 1000)}
          </span>
        )}

        {/* Exit */}
        <button
          type="button"
          onClick={onExit}
          className="ml-auto shrink-0 bg-lime text-primary-foreground text-[9px] uppercase tracking-widest px-3 py-1.5 border border-lime hover:opacity-90 transition font-bold"
        >
          ← Exit Compare
        </button>
      </div>

      {/* Two-column header: version info for A and B */}
      {(() => {
        // Active section label for the current loop (shown in status tag when playing)
        const activeLoopSectionId = loopSource === 'a' ? loopSectionIdA : loopSectionIdB
        const activeLoopSections  = loopSource === 'a' ? sectionsA : sectionsB
        const activeLoopSection   = loopOn ? activeLoopSections.find(s => s.id === activeLoopSectionId) : undefined
        const activeSectionLabel  = activeLoopSection ? sectionLabel(activeLoopSection) : undefined

        return (
          <div className="flex shrink-0 border-b border-border">
            <div className="shrink-0 border-r border-border bg-surface/40 flex items-center px-3" style={{ width: 140 }}>
              <span className="text-[9px] uppercase tracking-widest font-bold text-muted-foreground">Channel</span>
            </div>
            <div className="flex-1 min-w-0 flex">
              <div className="flex-1 min-w-0 border-r border-border">
                <VersionSideHeader
                  side="A"
                  versions={versions}
                  selectedId={versionAId}
                  onSelect={id => { setVersionAId(id); if (id === versionBId) setVersionBId('') }}
                  volume={volA}
                  onVolume={v => { setVolA(v); audio.setSideVolume('a', v) }}
                  isAudible={audio.abMode !== 'b'}
                  playing={audio.playing}
                  loaded={audio.loadedA}
                  total={audio.totalA}
                  loopOn={loopOn}
                  activeSectionLabel={activeSectionLabel}
                  onUseAsMaster={() => onSetMaster(versionAId)}
                  bColor={bColor}
                />
              </div>
              <div className="flex-1 min-w-0">
                <VersionSideHeader
                  side="B"
                  versions={versions.filter(v => v.id !== versionAId)}
                  selectedId={versionBId}
                  onSelect={id => setVersionBId(id)}
                  volume={volB}
                  onVolume={v => { setVolB(v); audio.setSideVolume('b', v) }}
                  isAudible={audio.abMode !== 'a'}
                  playing={audio.playing}
                  loaded={audio.loadedB}
                  total={audio.totalB}
                  loopOn={loopOn}
                  activeSectionLabel={activeSectionLabel}
                  onUseAsMaster={() => onSetMaster(versionBId)}
                  bColor={bColor}
                />
              </div>
            </div>
          </div>
        )
      })()}

      {/* Bar ruler — above structure, like default view */}
      <div className="flex shrink-0 border-b border-border" style={{ height: 22 }}>
        <div
          className="shrink-0 border-r border-border bg-surface/40 flex items-center px-3"
          style={{ width: 140 }}
        >
          <span className="text-[9px] uppercase tracking-widest font-bold text-muted-foreground">Bars</span>
        </div>
        <div className="flex-1 min-w-0 flex">
          {/* Side A: 28px spacer matches M/S buttons, ruler aligns with waveforms */}
          <div className="flex-1 min-w-0 border-r border-border flex overflow-hidden">
            <div className="shrink-0 bg-surface/40" style={{ width: 28 }} />
            <div className="flex-1 min-w-0 overflow-hidden">
              <BarRuler
                totalDurationMs={totalDurationMs}
                barDurationMs={barDurationMs}
                currentTimeMsRef={audio.currentTimeMsRef}
                playing={audio.playing}
                onSeek={audio.seek}
              />
            </div>
          </div>
          {/* Side B: same 28px spacer */}
          <div className="flex-1 min-w-0 flex overflow-hidden">
            <div className="shrink-0 bg-surface/40" style={{ width: 28 }} />
            <div className="flex-1 min-w-0 overflow-hidden">
              <BarRuler
                totalDurationMs={totalDurationMs}
                barDurationMs={barDurationMs}
                currentTimeMsRef={audio.currentTimeMsRef}
                playing={audio.playing}
                onSeek={audio.seek}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Structure ribbons — below bar ruler, like default view */}
      <div className="flex shrink-0 border-b border-border">
        <div
          className="shrink-0 border-r border-border flex items-center px-3 bg-lime-soft/40"
          style={{ width: 140 }}
        >
          <span className="text-[9px] uppercase tracking-widest font-bold text-lime">Structure</span>
        </div>
        <div className="flex-1 min-w-0 flex">
          {/* Side A: 28px spacer matches M/S buttons */}
          <div className="flex-1 min-w-0 border-r border-border flex overflow-hidden">
            <div className="shrink-0 bg-lime-soft/40" style={{ width: 28 }} />
            <div className="flex-1 min-w-0 overflow-hidden">
              <SectionRibbon
                sections={sectionsA}
                side="A"
                bSectionBg={bColorSoft}
                bSectionBorder={bColorBorder}
                bSectionText={bColorText}
              />
            </div>
          </div>
          {/* Side B: same 28px spacer */}
          <div className="flex-1 min-w-0 flex overflow-hidden">
            <div className="shrink-0 bg-lime-soft/40" style={{ width: 28 }} />
            <div className="flex-1 min-w-0 overflow-hidden">
              <SectionRibbon
                sections={sectionsB}
                side="B"
                bSectionBg={bColorSoft}
                bSectionBorder={bColorBorder}
                bSectionText={bColorText}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Track rows */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-none">
        {pairs.length === 0 ? (
          <div className="px-6 py-12 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
            No tracks in selected versions
          </div>
        ) : (
          pairs.map((pair, i) => (
            <CompareTrackRow
              key={comparePairKey(pair)}
              pair={pair}
              index={i}
              totalDurationMs={totalDurationMs}
              barDurationMs={barDurationMs}
              currentTimeMsRef={audio.currentTimeMsRef}
              playing={audio.playing}
              mutedA={pair.trackA ? mutedTracksA.has(pair.trackA.id) : false}
              mutedB={pair.trackB ? mutedTracksB.has(pair.trackB.id) : false}
              soloedA={pair.trackA ? soloedTracksA.has(pair.trackA.id) : false}
              soloedB={pair.trackB ? soloedTracksB.has(pair.trackB.id) : false}
              onMuteA={() => pair.trackA && toggleMuteA(pair.trackA.id)}
              onMuteB={() => pair.trackB && toggleMuteB(pair.trackB.id)}
              onSoloA={() => pair.trackA && toggleSoloA(pair.trackA.id)}
              onSoloB={() => pair.trackB && toggleSoloB(pair.trackB.id)}
              bColor={bColor}
              resolvedDurationsA={audio.resolvedDurationsA}
              resolvedDurationsB={audio.resolvedDurationsB}
              projectBpm={project?.bpm ?? 120}
            />
          ))
        )}

        {/* Comments */}
        {(commentsA.length > 0 || commentsB.length > 0) && (
          <div className="border-t border-border">
            <div className="flex">
              <div className="shrink-0 border-r border-border bg-surface/40 px-3 py-2 flex items-center" style={{ width: 140 }}>
                <span className="text-[9px] uppercase tracking-widest font-bold text-muted-foreground">
                  Comments · Both
                </span>
              </div>
              <div className="flex-1 flex">
                {/* Version A comments */}
                <div className="flex-1 border-r border-border px-4 py-3 flex flex-col gap-2">
                  {commentsA.slice(0, 4).map(c => (
                    <div key={c.id} className="text-[10px]">
                      <span className="text-lime font-bold uppercase">A · {c.versionName}</span>
                      <span className="text-muted-foreground mx-1.5">@{c.author_username}</span>
                      <span className="text-[9px] text-muted-foreground/60">{fmtTime(c.timecode_start_ms / 1000)}</span>
                      <p className="mt-0.5 text-muted-foreground/80 text-[10px] m-0">{c.content}</p>
                    </div>
                  ))}
                  {commentsA.length === 0 && (
                    <span className="text-[9px] text-muted-foreground/40 italic">No comments</span>
                  )}
                </div>
                {/* Version B comments */}
                <div className="flex-1 px-4 py-3 flex flex-col gap-2">
                  {commentsB.slice(0, 4).map(c => (
                    <div key={c.id} className="text-[10px]">
                      <span className="font-bold uppercase" style={{ color: bColorText }}>B · {c.versionName}</span>
                      <span className="text-muted-foreground mx-1.5">@{c.author_username}</span>
                      <span className="text-[9px] text-muted-foreground/60">{fmtTime(c.timecode_start_ms / 1000)}</span>
                      <p className="mt-0.5 text-muted-foreground/80 text-[10px] m-0">{c.content}</p>
                    </div>
                  ))}
                  {commentsB.length === 0 && (
                    <span className="text-[9px] text-muted-foreground/40 italic">No comments</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>


    </div>

    {/* Transport bar — portaled to page-level slot so it sits at same position as MasterPlayerBar */}
    {transportSlot && createPortal(
      <CompareTransportBar
        playing={audio.playing}
        currentTimeMs={audio.currentTimeMs}
        duration={audio.duration}
        onPlay={audio.play}
        onPause={audio.pause}
        onSeek={audio.seek}
        abMode={audio.abMode}
        versionA={versionA}
        versionB={versionB}
      />,
      transportSlot,
    )}
    </>
  )
}
