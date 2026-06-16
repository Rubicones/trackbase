'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { getSharedAudioContext, getMasterOutput } from './audioContext'

const SCHEDULE_AHEAD_S = 0.1   // look-ahead window (100 ms)
const LOOKAHEAD_MS     = 25    // scheduler poll interval (ms)

// ── Click factory ─────────────────────────────────────────────────────────────
// Routes through the caller's GainNode so volume is controlled centrally.
// Returns the OscillatorNode so callers can cancel it before it fires.
function createClick(
  audioCtx: AudioContext,
  gainNode: GainNode,
  time: number,
  isDownbeat: boolean,
): OscillatorNode {
  const osc = audioCtx.createOscillator()
  const env = audioCtx.createGain()
  osc.type = 'square'
  osc.frequency.value = isDownbeat ? 1000 : 700
  env.gain.setValueAtTime(0.22, time)
  env.gain.exponentialRampToValueAtTime(0.0001, time + 0.05)
  osc.connect(env)
  env.connect(gainNode)
  osc.start(time)
  osc.stop(time + 0.06)
  return osc
}

export function useMetronome() {
  const [metronomeOn, setMetronomeOn] = useState(false)
  const [countdownOn, setCountdownOn] = useState(false)
  const [isCounting, setIsCounting]   = useState(false)
  const [beatFlash, setBeatFlash]     = useState(0)
  // Volume persisted in localStorage across sessions
  const [metroVol, setMetroVolState]  = useState<number>(() => {
    if (typeof window === 'undefined') return 0.7
    const stored = localStorage.getItem('metronome-volume')
    return stored !== null ? Math.max(0, Math.min(1, parseFloat(stored))) : 0.7
  })

  // ── Core refs ──────────────────────────────────────────────────────────────
  const timerRef       = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * AudioContext time that corresponds to song position 0 ms.
   * Recomputed on every play-start and seek:
   *   songZero = audioCtx.currentTime - currentPosSec
   */
  const songZeroRef    = useRef(0)
  const bpmRef         = useRef(120)
  const beatsPerBarRef = useRef(4)
  /** OscillatorNodes scheduled but not yet fired — used for cancellation. */
  const scheduledRef   = useRef<{ node: OscillatorNode; time: number }[]>([])
  /** Persistent GainNode; all clicks route through it for central volume control. */
  const gainNodeRef    = useRef<GainNode | null>(null)

  // ── Stable state refs ──────────────────────────────────────────────────────
  const metronomeOnRef = useRef(false)
  metronomeOnRef.current = metronomeOn
  const countdownOnRef = useRef(false)
  countdownOnRef.current = countdownOn
  const isCountingRef  = useRef(false)
  isCountingRef.current = isCounting
  const metroVolRef    = useRef(metroVol)
  metroVolRef.current  = metroVol

  // ── Persistent GainNode ────────────────────────────────────────────────────
  const getGainNode = useCallback((): GainNode => {
    const audioCtx = getSharedAudioContext()
    if (!gainNodeRef.current || gainNodeRef.current.context.state === 'closed') {
      const g = audioCtx.createGain()
      g.gain.value = metroVolRef.current
      g.connect(getMasterOutput())
      gainNodeRef.current = g
    }
    return gainNodeRef.current
  }, [])

  // ── Volume control ─────────────────────────────────────────────────────────
  const setMetroVol = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    setMetroVolState(clamped)
    if (typeof window !== 'undefined') {
      localStorage.setItem('metronome-volume', String(clamped))
    }
    if (gainNodeRef.current) gainNodeRef.current.gain.value = clamped
  }, [])

  // ── Cancel all future-scheduled clicks ────────────────────────────────────
  const cancelPendingClicks = useCallback(() => {
    const now = getSharedAudioContext().currentTime
    for (const { node } of scheduledRef.current) {
      try { node.stop(now) } catch { /* already stopped or started */ }
    }
    scheduledRef.current = []
  }, [])

  const recomputeSongZero = useCallback((currentPosSec: number, playbackAnchorSec?: number) => {
    const audioCtx = getSharedAudioContext()
    songZeroRef.current = playbackAnchorSec ?? (audioCtx.currentTime - currentPosSec)
  }, [])

  // ── Scheduler loop ─────────────────────────────────────────────────────────
  /**
   * Each beat N in the song has a fixed absolute AudioContext time:
   *   beatTime(N) = songZero + N * beatDuration
   *
   * The loop finds the first beat index not yet past, then schedules every
   * beat whose time falls within the look-ahead window.
   *
   * beatInBar = N mod beatsPerBar — handles negative indices for countdown.
   */
  const runScheduler = useCallback(() => {
    if (!metronomeOnRef.current) { timerRef.current = null; return }
    const audioCtx      = getSharedAudioContext()
    const now           = audioCtx.currentTime
    const beatDur       = 60 / bpmRef.current
    const beatsPerBar   = beatsPerBarRef.current
    const songZero      = songZeroRef.current
    const scheduleUntil = now + SCHEDULE_AHEAD_S
    const gainNode      = getGainNode()

    // First beat index at or ahead of now
    let idx = Math.ceil((now - songZero) / beatDur)

    while (songZero + idx * beatDur < scheduleUntil) {
      const beatTime  = songZero + idx * beatDur
      if (beatTime > now) {
        // JS % can be negative — normalise to [0, beatsPerBar)
        const beatInBar = ((idx % beatsPerBar) + beatsPerBar) % beatsPerBar
        const node = createClick(audioCtx, gainNode, beatTime, beatInBar === 0)
        scheduledRef.current.push({ node, time: beatTime })
        node.onended = () => {
          scheduledRef.current = scheduledRef.current.filter(c => c.node !== node)
        }
      }
      idx++
    }

    // Prune entries that have already fired
    scheduledRef.current = scheduledRef.current.filter(c => c.time > now - 1)

    timerRef.current = setTimeout(runScheduler, LOOKAHEAD_MS)
  }, [getGainNode])

  const stopScheduler = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // ── handlePlayStart ────────────────────────────────────────────────────────
  /**
   * Call when the player *actually* begins playing (after any count-in).
   * Anchors songZero to the current AudioContext time and starts the scheduler.
   */
  const handlePlayStart = useCallback((bpm: number, timeSig: string, currentPosSec: number, playbackAnchorSec?: number) => {
    if (!metronomeOnRef.current) return
    const audioCtx = getSharedAudioContext()
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
    bpmRef.current = bpm
    beatsPerBarRef.current = parseInt(timeSig.split('/')[0]) || 4
    stopScheduler()
    cancelPendingClicks()
    recomputeSongZero(currentPosSec, playbackAnchorSec)
    runScheduler()
  }, [stopScheduler, cancelPendingClicks, recomputeSongZero, runScheduler])

  // ── handlePlayPause ────────────────────────────────────────────────────────
  const handlePlayPause = useCallback(() => {
    stopScheduler()
    cancelPendingClicks()
  }, [stopScheduler, cancelPendingClicks])

  // ── handleSeek ─────────────────────────────────────────────────────────────
  const handleSeek = useCallback((
    bpm: number, timeSig: string, newPosSec: number, isPlaying: boolean, playbackAnchorSec?: number,
  ) => {
    if (!isPlaying || !metronomeOnRef.current) return
    bpmRef.current = bpm
    beatsPerBarRef.current = parseInt(timeSig.split('/')[0]) || 4
    stopScheduler()
    cancelPendingClicks()
    recomputeSongZero(newPosSec, playbackAnchorSec)
    runScheduler()
  }, [cancelPendingClicks, stopScheduler, recomputeSongZero, runScheduler])

  // ── playCountdown ──────────────────────────────────────────────────────────
  /**
   * Schedules exactly one bar of countdown clicks starting immediately,
   * then resolves after that bar completes.
   *
   * Sets songZeroRef so that when the player starts at `currentPosSec`
   * (after the countdown bar), the beat grid is perfectly aligned.
   *
   * Countdown beats fall at the beat indices immediately before the
   * `currentPosSec` position. When metronome is ON, the scheduler
   * continues naturally from those same indices — no seam.
   *
   * Works regardless of whether the metronome is on or off; the countdown
   * always plays via the same GainNode (respecting the volume slider).
   *
   * @param currentPosSec  Project position (seconds) where playback will
   *                       begin *after* the countdown bar completes.
   */
  const playCountdown = useCallback((
    bpm: number,
    timeSig: string,
    currentPosSec: number,
  ): Promise<void> => {
    const beatsPerBar = parseInt(timeSig.split('/')[0]) || 4
    const beatDur     = 60 / bpm
    const barDur      = beatDur * beatsPerBar
    const audioCtx    = getSharedAudioContext()
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
    const gainNode    = getGainNode()

    // Small preparation gap before first click
    const countdownStart     = audioCtx.currentTime + 0.05
    // When playback begins (end of countdown bar)
    const playStartAudioTime = countdownStart + barDur

    // Anchor the beat grid: playStartAudioTime aligns with currentPosSec
    bpmRef.current = bpm
    beatsPerBarRef.current = beatsPerBar
    songZeroRef.current = playStartAudioTime - currentPosSec

    // Beat index at countdownStart, relative to songZero
    const countdownStartIdx = Math.round((countdownStart - songZeroRef.current) / beatDur)

    for (let i = 0; i < beatsPerBar; i++) {
      const beatIdx   = countdownStartIdx + i
      const beatTime  = songZeroRef.current + beatIdx * beatDur
      const beatInBar = ((beatIdx % beatsPerBar) + beatsPerBar) % beatsPerBar
      const node      = createClick(audioCtx, gainNode, beatTime, beatInBar === 0)
      scheduledRef.current.push({ node, time: beatTime })
      node.onended = () => {
        scheduledRef.current = scheduledRef.current.filter(c => c.node !== node)
      }
      // Drive the visual beat flash
      const delayMs = Math.max(0, (beatTime - audioCtx.currentTime) * 1000)
      setTimeout(() => setBeatFlash(n => n + 1), delayMs)
    }

    return new Promise(res => setTimeout(res, Math.round(barDur * 1000) + 80))
  }, [getGainNode])

  // ── startPlayWithCountIn ───────────────────────────────────────────────────
  /**
   * Wraps a play action with optional count-in.
   *
   * When countdown is ON:
   *   - playCountdown() pre-sets songZeroRef and schedules the bar of clicks.
   *   - doPlay() is called after the bar finishes.
   *   - handlePlayStart() inside doPlay() reanchors songZero (≈same value,
   *     tiny execution-time correction) and starts the scheduler if metro is ON.
   *
   * When countdown is OFF:
   *   - doPlay() is called immediately.
   *   - handlePlayStart() sets songZero and starts the scheduler.
   *
   * The metronome scheduler is started inside doPlay() via handlePlayStart(),
   * NOT here. That keeps countdown and non-countdown paths symmetric.
   */
  const startPlayWithCountIn = useCallback(async (
    bpm: number,
    timeSig: string,
    currentPosSec: number,
    doPlay: () => void,
  ) => {
    if (countdownOnRef.current) {
      setIsCounting(true)
      await playCountdown(bpm, timeSig, currentPosSec)
      if (!isCountingRef.current) return   // cancelled while counting
      setIsCounting(false)
    }
    doPlay()
  }, [playCountdown])

  // ── cancelCountIn ──────────────────────────────────────────────────────────
  const cancelCountIn = useCallback(() => {
    if (isCountingRef.current) {
      setIsCounting(false)
      cancelPendingClicks()
      stopScheduler()
    }
  }, [cancelPendingClicks, stopScheduler])

  // ── toggleMetronome ────────────────────────────────────────────────────────
  const toggleMetronome = useCallback((
    bpm: number,
    timeSig: string,
    isPlaying: boolean,
    getPlaybackAnchor?: () => number,
  ) => {
    const turning = !metronomeOnRef.current
    metronomeOnRef.current = turning
    setMetronomeOn(turning)
    if (turning) {
      const audioCtx = getSharedAudioContext()
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
      bpmRef.current = bpm
      beatsPerBarRef.current = parseInt(timeSig.split('/')[0]) || 4
      if (isPlaying && getPlaybackAnchor) {
        stopScheduler()
        cancelPendingClicks()
        const anchor = getPlaybackAnchor()
        const livePos = audioCtx.currentTime - anchor
        recomputeSongZero(livePos, anchor)
        runScheduler()
      }
    } else {
      stopScheduler()
      cancelPendingClicks()
    }
  }, [runScheduler, stopScheduler, cancelPendingClicks, recomputeSongZero])

  const toggleCountdown = useCallback(() => setCountdownOn(c => !c), [])

  useEffect(() => () => {
    stopScheduler()
    cancelPendingClicks()
  }, [stopScheduler, cancelPendingClicks])

  return {
    metronomeOn,
    countdownOn,
    isCounting,
    beatFlash,
    metroVol,
    setMetroVol,
    toggleMetronome,
    toggleCountdown,
    handlePlayStart,
    handlePlayPause,
    handleSeek,
    playCountdown,
    startPlayWithCountIn,
    cancelCountIn,
  }
}
