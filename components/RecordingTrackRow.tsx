'use client'

import { useRef, useState, useEffect, useCallback, memo, type MutableRefObject } from 'react'
import type { Track } from '@/lib/types'
import { getSharedAudioContext, getMasterOutput } from '@/lib/audioContext'
import { getRecordingAudioContext, resumeRecordingAudioContext } from '@/lib/recordingAudioContext'
import { isMicStreamLive, acquireMicStream } from '@/lib/micCapture'
import { trackEvent } from '@/lib/analytics'
import { TactGrid } from '@/components/design/TactGrid'
import { useMobileTimelineScroll, useRegisterTimelineScroll } from '@/components/MobileTimelineScrollSync'
import { snapToPreviousBarSec, barDurationSec } from '@/lib/metronomeAudio'
import { waveformBarsCache } from '@/lib/waveformCache'
import { WaveformBarRow, downsampleWaveformBars } from '@/components/WaveformBars'

const TRACK_LABEL_W = 192
const TRACK_ROW_H = 96
const WAVEFORM_COLOR = 'var(--lime, #e07a5f)'
const BAR_COUNT = 96
const METER_RENDER_MS = 70
// Cap the live-waveform sample buffer so multi-minute takes don't grow the array
// (and the rendered DOM) without bound. ~1200 samples ≈ 84s at full resolution;
// beyond that we halve resolution in place, keeping the full span.
const MAX_LIVE_RECORDING_BARS = 1200

const BUILTIN_MIC_KEYWORDS = ['built-in', 'default', 'internal', 'macbook', 'facetime']

function isBuiltinMic(label: string): boolean {
  const l = label.toLowerCase()
  return BUILTIN_MIC_KEYWORDS.some(k => l.includes(k))
}

function encodeWAV(buffer: AudioBuffer, skipSamples = 0): Blob {
  const numCh  = buffer.numberOfChannels
  const sr     = buffer.sampleRate
  const skip   = Math.max(0, Math.min(skipSamples, buffer.length - 1))
  const total  = buffer.length - skip
  const byteLen = 44 + total * numCh * 2
  const ab = new ArrayBuffer(byteLen)
  const v  = new DataView(ab)
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  str(0, 'RIFF'); v.setUint32(4, byteLen - 8, true)
  str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, numCh, true); v.setUint32(24, sr, true)
  v.setUint32(28, sr * numCh * 2, true); v.setUint16(32, numCh * 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, total * numCh * 2, true)
  const chs = Array.from({ length: numCh }, (_, c) => buffer.getChannelData(c))
  let off = 44
  for (let i = skip; i < skip + total; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, chs[c][i]))
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      off += 2
    }
  }
  return new Blob([ab], { type: 'audio/wav' })
}

function barsFromBuffer(buffer: AudioBuffer, n = BAR_COUNT): number[] {
  const raw = buffer.getChannelData(0)
  const block = Math.max(1, Math.floor(raw.length / n))
  const amps: number[] = []
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = 0; j < block; j++) s += Math.abs(raw[i * block + j])
    amps.push(s / block)
  }
  const max = Math.max(...amps, 0.001)
  return amps.map(a => a / max)
}


/** Scale every sample by `gain` (encodeWAV clamps to [-1, 1], so clipping is bounded). */
function applyGainToBuffer(buffer: AudioBuffer, gain: number): AudioBuffer {
  if (gain === 1) return buffer
  const out = new AudioBuffer({
    length: buffer.length,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
  })
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c)
    const dst = out.getChannelData(c)
    for (let i = 0; i < src.length; i++) dst[i] = src[i] * gain
  }
  return out
}

/** Shift recorded audio earlier (negative ms) or later (positive ms) at sample precision. */
function applyNudgeToBuffer(buffer: AudioBuffer, nudgeMs: number): AudioBuffer {
  if (nudgeMs === 0) return buffer

  const sr = buffer.sampleRate
  const numCh = buffer.numberOfChannels
  const sampleDelta = Math.round((nudgeMs / 1000) * sr)

  if (sampleDelta < 0) {
    const skip = Math.min(Math.abs(sampleDelta), buffer.length - 1)
    if (skip <= 0) return buffer
    const out = new AudioBuffer({ length: buffer.length - skip, numberOfChannels: numCh, sampleRate: sr })
    for (let c = 0; c < numCh; c++) {
      out.getChannelData(c).set(buffer.getChannelData(c).subarray(skip))
    }
    return out
  }

  if (sampleDelta === 0) return buffer
  const out = new AudioBuffer({ length: buffer.length + sampleDelta, numberOfChannels: numCh, sampleRate: sr })
  for (let c = 0; c < numCh; c++) {
    out.getChannelData(c).set(buffer.getChannelData(c), sampleDelta)
  }
  return out
}

function BarWaveform({
  bars, leftPct, widthPct, color = WAVEFORM_COLOR, opacity = 1, minBarPct, bottom = false,
  animate = false, barCount = BAR_COUNT,
}: {
  bars: number[]
  leftPct: string
  widthPct: string
  color?: string
  opacity?: number
  minBarPct?: number
  bottom?: boolean
  animate?: boolean
  barCount?: number
}) {
  if (!bars.length) return null
  const display = downsampleWaveformBars(bars, barCount)
  return (
    <div
      className={bottom
        ? 'absolute bottom-3 z-[2]'
        : 'absolute top-2 bottom-2 z-[2]'}
      style={{ left: leftPct, width: widthPct, opacity, height: bottom ? 32 : undefined, minWidth: bottom ? 24 : undefined }}
    >
      <WaveformBarRow
        bars={display}
        color={color}
        className="h-full px-1"
        animate={animate}
        minBarPct={minBarPct}
      />
    </div>
  )
}

/** Horizontal input-level meter — grows wider (left→right) with loudness. */
function LiveVolumeBar({
  level, pulsing = false, leftPct, widthPct,
}: {
  level: number
  pulsing?: boolean
  leftPct?: string
  widthPct?: string
}) {
  const positioned = leftPct != null && widthPct != null
  return (
    <div
      className={positioned ? 'absolute z-[2]' : 'absolute left-0 right-0 z-[2]'}
      style={{
        bottom: 12,
        height: 5,
        ...(positioned ? { left: leftPct, width: widthPct } : {}),
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${Math.min(100, Math.max(0, level * 100))}%`,
          background: 'var(--lime)',
          opacity: pulsing ? 0.95 : 0.75,
          animation: pulsing ? 'recPulse 1s ease-in-out infinite' : undefined,
          transition: 'width 60ms ease-out',
          borderRadius: '0 2px 2px 0',
        }}
      />
    </div>
  )
}

function NudgeArrowIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden className="block">
      <polygon points={direction === 'left' ? '6,1 2,4 6,7' : '2,1 6,4 2,7'} />
    </svg>
  )
}

export type RecordState = 'idle' | 'permitting' | 'armed' | 'countdown' | 'recording' | 'preview' | 'saving'

export type RecordingTrackControl = {
  arm: (prefetchedStream?: MediaStream) => Promise<void>
  startRecord: () => Promise<void>
  stopRecord: () => void
  getState: () => RecordState
}

const MOBILE_TIMELINE_MIN_WIDTH_PCT = 180
const MOBILE_TIMELINE_PCT_PER_BAR = 6
const TIMELINE_SCROLL_RIGHT_PAD_PX = 32
const TIMELINE_SCROLL_LEFT_PAD_PX = 16
const BARS_PER_TACT = 4

/** Same tact grid as MobileMixerPortrait track lanes — equal-width columns per 4 bars. */
function MobileTimelineGrid({ totalBars }: { totalBars: number }) {
  const tactCount = Math.max(1, Math.ceil(totalBars / BARS_PER_TACT))
  return (
    <div className="absolute inset-0 flex pointer-events-none">
      {Array.from({ length: tactCount }, (_, i) => (
        <div
          key={i}
          className={`flex-1 ${
            (i + 1) % 4 === 0 ? 'border-r border-border/40' : 'border-r border-border/15'
          } last:border-r-0`}
        />
      ))}
    </div>
  )
}

export interface RecordingTrackRowProps {
  id: string
  name: string
  onNameChange: (id: string, name: string) => void
  versionId: string
  bpm: number
  timeSig: string
  totalBars: number
  countdownEnabled: boolean
  getPlaybackMs: () => number
  isPlaying: boolean
  /** Incremented by the player on every seek. Including this in the preview
   *  useEffect dep array ensures the AudioBufferSourceNode is stopped and
   *  restarted from the new position when the user seeks while playing,
   *  because isPlaying alone doesn't change in that case. */
  seekEpoch?: number
  isActiveRecording: boolean
  onArm:     (id: string) => void
  onRelease: (id: string) => void
  onSaved:   (id: string, track: Track) => void
  onDelete:  (id: string) => void
  onPlaybackStart: (atTime?: number) => void
  onPlaybackStop:  () => void
  onSeekTo: (positionSec: number) => void
  onPreviewTimelineChange?: (id: string, endSec: number | null) => void
  recordingStopRef?: MutableRefObject<(() => void) | null>
  onPreparePlayback?: () => void
  playCountdown: (bpm: number, timeSig: string) => Promise<{
    promise: Promise<void>
    takeStartTime: number
    /** Stops the scheduled count-in clicks and resolves `promise` immediately. */
    cancel?: () => void
  }>
  registerControl?: (id: string, control: RecordingTrackControl | null) => void
  onStateChange?: (id: string, state: RecordState) => void
  /** Mobile mixer: wide scrollable timeline so mid-song record points are reachable. */
  mobileScrollableTimeline?: boolean
}

export const RecordingTrackRow = memo(function RecordingTrackRow({
  id, name, onNameChange,
  versionId, bpm, timeSig, totalBars, countdownEnabled,
  getPlaybackMs, isPlaying, seekEpoch = 0,
  isActiveRecording,
  onArm, onRelease, onSaved, onDelete,
  onPlaybackStart, onPlaybackStop, onSeekTo,
  onPreviewTimelineChange,
  recordingStopRef,
  onPreparePlayback,
  playCountdown,
  registerControl,
  onStateChange,
  mobileScrollableTimeline = false,
}: RecordingTrackRowProps) {
  const [state, setState]           = useState<RecordState>('idle')
  const [devices, setDevices]       = useState<MediaDeviceInfo[]>([])
  const [selectedDevice, setSelectedDevice] = useState('')
  // Non-zero default so monitoring is audible as soon as the row arms, before
  // device enumeration refines built-in vs external levels.
  const [monitorVol, setMonitorVol] = useState(0.5)
  const [previewMuted, setPreviewMuted] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError]           = useState('')
  const [editName, setEditName]     = useState(name)
  const [recordedDurationSec, setRecordedDurationSec] = useState(0)
  const [recordingSec, setRecordingSec] = useState(0)
  const [staticBars, setStaticBars] = useState<number[]>([])
  const [recordingBars, setRecordingBars] = useState<number[]>([])
  const [inputLevel, setInputLevel] = useState(0)
  const [recordStartBar, setRecordStartBar] = useState(0)
  const [armedAtBar, setArmedAtBar] = useState(0)
  const [nudgeOffsetMs, setNudgeOffsetMs] = useState(0)
  // Take volume (0–3, default 1). Applied live to the preview playback and
  // baked into the WAV samples on save, so the saved track sits in the mix
  // exactly as previewed.
  const [takeGain, setTakeGain] = useState(1)
  // Timeline width snapshot taken when a take starts, so the live waveform keeps a
  // constant bar width and stays anchored instead of reflowing as the take/playhead
  // grow. Null except while recording.
  const [frozenTimelineBars, setFrozenTimelineBars] = useState<number | null>(null)

  const streamRef       = useRef<MediaStream | null>(null)
  const recorderRef     = useRef<MediaRecorder | null>(null)
  // Dedicated clone of the mic track used only by the MediaRecorder — see handleStartRecord.
  const recordTrackRef  = useRef<MediaStreamTrack | null>(null)
  // Once the user drags the Monitor slider, stop auto-setting a default level.
  const monitorTouchedRef = useRef(false)
  const chunksRef       = useRef<Blob[]>([])
  const audioBufferRef  = useRef<AudioBuffer | null>(null)
  const startBarRef     = useRef(0)
  const previewSrcRef   = useRef<AudioBufferSourceNode | null>(null)
  const recordTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const armGenRef       = useRef(0)
  const armInFlightRef  = useRef(false)
  // Bumped whenever the current take is stopped/cancelled/discarded so async
  // continuations (post-countdown) can detect they were superseded.
  const takeGenRef      = useRef(0)
  const countdownCancelRef = useRef<(() => void) | null>(null)
  const seekEpochBaselineRef = useRef(0)
  const seenPlayingRef  = useRef(false)
  const takeGainRef     = useRef(takeGain)
  takeGainRef.current = takeGain
  const errorRef        = useRef('')
  errorRef.current = error
  const previewGainRef  = useRef<GainNode | null>(null)
  const stateRef        = useRef<RecordState>('idle')
  stateRef.current = state
  // setState + synchronous stateRef update. Several flows (mobile prefetched-
  // stream arm, auto-arm effect) read stateRef in the same tick the state
  // changes, before React re-renders — the render-time mirror alone is stale.
  const setRecState = useCallback((s: RecordState) => {
    stateRef.current = s
    setState(s)
  }, [])
  const monitorVolRef   = useRef(monitorVol)
  monitorVolRef.current = monitorVol
  const meterSourceRef  = useRef<MediaStreamAudioSourceNode | null>(null)
  const meterAnalyserRef = useRef<AnalyserNode | null>(null)
  // Holds the monitor GainNode — gain.value == monitorVol so we can update it live
  const meterMonitorRef = useRef<GainNode | null>(null)
  const meterRafRef     = useRef(0)
  const meterDataRef    = useRef<Float32Array<ArrayBuffer> | null>(null)
  const lastMeterRenderRef = useRef(0)
  const waveformScrollRef = useRef<HTMLDivElement>(null)
  const scrollSync = useMobileTimelineScroll()
  useRegisterTimelineScroll(waveformScrollRef)

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(meterRafRef.current)
    meterRafRef.current = 0
    try { meterSourceRef.current?.disconnect() } catch { /* ok */ }
    try { meterAnalyserRef.current?.disconnect() } catch { /* ok */ }
    try { meterMonitorRef.current?.disconnect() } catch { /* ok */ }
    meterSourceRef.current = null
    meterAnalyserRef.current = null
    meterMonitorRef.current = null
    meterDataRef.current = null
    setInputLevel(0)
  }, [])

  const applyMonitorGain = useCallback((g: GainNode | null = meterMonitorRef.current) => {
    if (!g) return
    // Hear input while armed / count-in; mute only once the take is rolling.
    g.gain.value = stateRef.current === 'recording' ? 0 : monitorVolRef.current
  }, [])

  const startMeter = useCallback(async (stream: MediaStream) => {
    stopMeter()
    const ctx = await resumeRecordingAudioContext()
    if (streamRef.current !== stream) return
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.3
    // Route source → analyser → monitorGain → destination.
    // This keeps the graph pulled (so the analyser gets data) and provides
    // low-latency Web Audio monitoring — no <audio> element buffering involved.
    const monGain = ctx.createGain()
    applyMonitorGain(monGain)
    source.connect(analyser)
    analyser.connect(monGain)
    monGain.connect(ctx.destination)
    meterSourceRef.current = source
    meterAnalyserRef.current = analyser
    meterMonitorRef.current = monGain
    const meterBuf = new Float32Array(analyser.fftSize) as Float32Array<ArrayBuffer>
    meterDataRef.current = meterBuf
    lastMeterRenderRef.current = 0

    const tick = (now: number) => {
      meterRafRef.current = requestAnimationFrame(tick)
      // Keep the monitoring context alive — browsers often re-suspend after the
      // Record-track click before Rec is pressed, which silences armed monitoring.
      if (ctx.state === 'suspended') void ctx.resume()
      const an = meterAnalyserRef.current
      const buf = meterDataRef.current
      if (!an || !buf) return

      // Only touch React state at the meter cadence (~METER_RENDER_MS), never on
      // every animation frame. Setting state 60×/s while recording a long take
      // floods React with re-renders and GC churn, which can starve the audio
      // pipeline and make the MediaRecorder stall on long recordings.
      if (now - lastMeterRenderRef.current < METER_RENDER_MS) return
      lastMeterRenderRef.current = now

      an.getFloatTimeDomainData(buf)
      let peak = 0
      for (let i = 0; i < buf.length; i++) {
        const abs = Math.abs(buf[i])
        if (abs > peak) peak = abs
      }
      const level = Math.min(1, peak * 1.8)

      if (stateRef.current === 'recording') {
        setRecordingBars(prev => {
          // Bound memory/DOM on very long takes: once we exceed the cap, halve
          // resolution in place (keep the louder of each pair) so the waveform
          // still spans the whole recording without growing without limit.
          if (prev.length >= MAX_LIVE_RECORDING_BARS) {
            const compacted: number[] = []
            for (let i = 0; i < prev.length; i += 2) {
              compacted.push(Math.max(prev[i], prev[i + 1] ?? prev[i]))
            }
            compacted.push(level)
            return compacted
          }
          return [...prev, level]
        })
      } else {
        setInputLevel(level)
      }
    }
    meterRafRef.current = requestAnimationFrame(tick)
  }, [applyMonitorGain, stopMeter])

  const stopStream = useCallback(() => {
    stopMeter()
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [stopMeter])

  const acquireMic = useCallback(async (deviceId: string, gen: number) => {
    if (streamRef.current) stopStream()
    const stream = await acquireMicStream(deviceId || undefined)
    if (gen !== armGenRef.current) {
      stream.getTracks().forEach(t => t.stop())
      return null
    }
    streamRef.current = stream
    return stream
  }, [stopStream])

  async function handleArm(prefetchedStream?: MediaStream) {
    if (armInFlightRef.current || stateRef.current !== 'idle' || isActiveRecording) {
      // A superseded prefetched stream would otherwise leak (mic stays open).
      prefetchedStream?.getTracks().forEach(t => t.stop())
      return
    }

    armInFlightRef.current = true
    const gen = ++armGenRef.current
    if (!prefetchedStream) setRecState('permitting')
    setError('')

    const abandon = (stream: MediaStream) => {
      stream.getTracks().forEach(t => t.stop())
      // Don't leave the row stuck on "Requesting mic…" after a superseded arm.
      if (stateRef.current === 'permitting') setRecState('idle')
    }

    try {
      const stream = prefetchedStream
        ?? await acquireMicStream(selectedDevice || undefined)
      if (gen !== armGenRef.current) {
        abandon(stream)
        return
      }

      // Yield — do not touch Web Audio or <audio> in the permission callback tick.
      if (!prefetchedStream) {
        await new Promise<void>(resolve => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
        if (gen !== armGenRef.current) {
          abandon(stream)
          return
        }
      }

      streamRef.current = stream
      // Set monitor level + start the graph before paint so armed monitoring is
      // live immediately (waiting on enumerateDevices left gain at silence).
      if (!monitorTouchedRef.current) {
        const label = stream.getAudioTracks()[0]?.label ?? ''
        const vol = isBuiltinMic(label) ? 0.35 : 0.7
        monitorVolRef.current = vol
        setMonitorVol(vol)
      }
      await resumeRecordingAudioContext()
      if (gen !== armGenRef.current) {
        abandon(stream)
        return
      }
      setRecState('armed')
      onArm(id)
      await startMeter(stream)
      if (gen !== armGenRef.current) return
      applyMonitorGain()

      window.setTimeout(() => {
        if (gen !== armGenRef.current || !streamRef.current) return
        void navigator.mediaDevices.enumerateDevices()
          .then(all => {
            if (gen !== armGenRef.current) return
            const audioIns = all.filter(d => d.kind === 'audioinput')
            setDevices(audioIns)
            const activeTrack = streamRef.current?.getAudioTracks()[0]
            const activeId = activeTrack?.getSettings().deviceId ?? ''
            if (activeId) setSelectedDevice(activeId)
            if (!monitorTouchedRef.current) {
              const vol = isBuiltinMic(activeTrack?.label ?? '') ? 0.35 : 0.7
              monitorVolRef.current = vol
              setMonitorVol(vol)
              applyMonitorGain()
            }
          })
          .catch(() => {})
      }, 400)
    } catch {
      if (gen === armGenRef.current) {
        setError('Mic access denied')
        setRecState('idle')
      }
    } finally {
      armInFlightRef.current = false
    }
  }

  useEffect(() => {
    return () => {
      armGenRef.current++
      takeGenRef.current++
      countdownCancelRef.current?.()
      countdownCancelRef.current = null
      try { previewSrcRef.current?.stop() } catch { /* already stopped */ }
      // MediaRecorder.stop() throws InvalidStateError when already inactive —
      // an uncaught throw here propagates into React's commit phase and can
      // take the whole route down. Never assume recorder state on unmount.
      const recorder = recorderRef.current
      if (recorder) {
        recorder.ondataavailable = null
        recorder.onstop = null
        recorder.onerror = null
        try { if (recorder.state !== 'inactive') recorder.stop() } catch { /* ok */ }
        recorderRef.current = null
      }
      try { recordTrackRef.current?.stop() } catch { /* ok */ }
      recordTrackRef.current = null
      stopStream()
    }
  }, [stopStream])

  // Live input meter — isolated context. Depends on a boolean, not `state`, so
  // the monitor/analyser graph survives armed → countdown → recording instead
  // of being torn down mid-take. handleArm also starts the graph immediately;
  // this effect covers remounts when already armed.
  const meterActive = state === 'armed' || state === 'countdown' || state === 'recording'
  useEffect(() => {
    if (!meterActive) {
      stopMeter()
      return
    }
    const stream = streamRef.current
    if (!stream) return
    // Already wired (e.g. handleArm) — keep it; only ensure context + gain.
    if (!meterMonitorRef.current) void startMeter(stream)
    else {
      void resumeRecordingAudioContext()
      applyMonitorGain()
    }
    // No cleanup here: tearing down on dep identity changes would kill armed
    // monitoring. Unmount / meterActive→false / stopStream handle teardown.
  }, [meterActive, startMeter, stopMeter, applyMonitorGain])

  // Monitor level: live while armed/count-in; hard-mute once recording.
  useEffect(() => {
    applyMonitorGain()
  }, [state, monitorVol, applyMonitorGain])

  // Re-resume monitoring context if the browser suspends it while we expect output.
  useEffect(() => {
    if (!meterActive) return
    const ctx = getRecordingAudioContext()
    const onState = () => {
      if (ctx.state === 'suspended' && stateRef.current !== 'idle') {
        void ctx.resume()
      }
    }
    ctx.addEventListener('statechange', onState)
    if (ctx.state === 'suspended') void ctx.resume()
    return () => ctx.removeEventListener('statechange', onState)
  }, [meterActive])

  // Track playhead while armed so the live meter sits at the upcoming record point.
  useEffect(() => {
    if (state !== 'armed') return
    const beatsPerBar = parseInt(timeSig.split('/')[0]) || 4
    const barDurMs = (60000 / bpm) * beatsPerBar
    const update = () => setArmedAtBar(Math.floor(getPlaybackMs() / barDurMs))
    update()
    const id = window.setInterval(update, 250)
    return () => clearInterval(id)
  }, [state, bpm, timeSig, getPlaybackMs])

  async function handleDeviceChange(deviceId: string) {
    setSelectedDevice(deviceId)
    const gen = armGenRef.current
    try {
      const stream = await acquireMic(deviceId, gen)
      if (stream) {
        if (stateRef.current === 'armed' || stateRef.current === 'countdown' || stateRef.current === 'recording') {
          void startMeter(stream)
        }
      }
    } catch {
      setError('Could not open device')
    }
  }

  function handleMonitorChange(vol: number) {
    monitorTouchedRef.current = true
    monitorVolRef.current = vol
    setMonitorVol(vol)
    applyMonitorGain()
  }

  async function handleStartRecord() {
    if (stateRef.current !== 'armed') return
    setError('')
    const takeGen = ++takeGenRef.current
    let playbackStarted = false

    try {
      // Ensure a LIVE mic stream before committing to the take. A stream can
      // exist but be dead (device unplugged, OS revoked, Bluetooth dropout) —
      // handing a dead track to MediaRecorder throws "MediaStream is inactive".
      if (!isMicStreamLive(streamRef.current)) {
        const stream = await acquireMic(selectedDevice, armGenRef.current)
        if (!stream) {
          setError('Microphone not available')
          return
        }
        if (takeGen !== takeGenRef.current) return
        // Rebind the meter/monitor graph to the fresh stream — the meter
        // effect only reacts to state changes, not stream swaps.
        void startMeter(stream)
      }

      const barDurSec = barDurationSec(bpm, timeSig)

      // Snap to the previous bar boundary and always play count-in.
      // Seek the player NOW so offsetRef is locked to the bar start — when
      // onPlaybackStart fires after the countdown, playback resumes from exactly
      // that bar, not from wherever the user originally paused.
      const snapPosSec = snapToPreviousBarSec(getPlaybackMs() / 1000, bpm, timeSig)
      const snapBar    = Math.round(snapPosSec / barDurSec)
      onSeekTo(snapPosSec)
      onPreparePlayback?.()

      setRecState('countdown')
      const { promise, takeStartTime, cancel } = await playCountdown(bpm, timeSig)
      countdownCancelRef.current = cancel ?? null
      onPlaybackStart(takeStartTime)
      playbackStarted = true

      startBarRef.current = snapBar
      setRecordStartBar(snapBar)

      chunksRef.current = []
      setRecordingSec(0)
      setRecordingBars([])
      setNudgeOffsetMs(0)
      setTakeGain(1)

      // Snapshot the timeline width now so the live waveform keeps a constant bar
      // width and fixed anchor as the take and playhead advance (see timelineBars).
      const startPlayheadBar = barDurSec > 0 ? Math.ceil(getPlaybackMs() / 1000 / barDurSec) : 0
      setFrozenTimelineBars(Math.max(totalBars, snapBar + 4, startPlayheadBar + 4))

      await promise
      countdownCancelRef.current = null

      // The count-in ran for a full bar — the user may have cancelled (seek,
      // pause, spacebar, ✕), the row may be unmounting, or the device may have
      // dropped. Never start the recorder for a superseded take.
      // (Read through a widened binding: TS otherwise keeps the 'armed'
      // narrowing from the guard at the top and can't see the ref mutation.)
      const stateAfterCountdown = stateRef.current as RecordState
      if (takeGen !== takeGenRef.current || stateAfterCountdown !== 'countdown') return

      // Re-check liveness AFTER the countdown, and clone only now. Cloning
      // before the wait meant a device change/dropout during the count-in
      // handed MediaRecorder a dead track — the exact "MediaStream is
      // inactive" crash.
      const micTrack = streamRef.current?.getAudioTracks().find(t => t.readyState === 'live')
      if (!micTrack) throw new Error('Microphone not available')

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/mp4'

      // Record from a dedicated CLONE of the mic track. The original track is held
      // by the Web Audio monitor graph (createMediaStreamSource in startMeter);
      // handing that same track to MediaRecorder makes Chrome capture silence —
      // one MediaStreamTrack can't reliably feed both Web Audio and a recorder.
      // A cloned track is an independent sink, so the monitor and the recorder
      // each get live audio.
      recordTrackRef.current?.stop()
      const recordTrack = micTrack.clone()
      recordTrackRef.current = recordTrack
      const recordStream = new MediaStream([recordTrack])

      let recorder: MediaRecorder
      try {
        recorder = new MediaRecorder(recordStream, { mimeType, audioBitsPerSecond: 128000 })
      } catch {
        recorder = new MediaRecorder(recordStream, { mimeType })
      }

      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        // The recorder can stop on its own — a USB/Bluetooth mic dropping out, the
        // OS switching the default device, or a browser resource limit on a long
        // take. In that case we're still in 'recording' state, so run the same
        // teardown the Stop button does; otherwise the captured take is stranded
        // (playback left running, state stuck on 'recording', no way to Save it).
        if (stateRef.current === 'recording' && takeGen === takeGenRef.current) {
          finalizeTakeRef.current({ pausePlayback: true })
        }
        void processBlob(mimeType)
      }
      recorder.onerror = () => {
        // Salvage whatever was captured before the error instead of losing the take.
        try { if (recorder.state !== 'inactive') recorder.stop() } catch { /* ok */ }
      }
      // If the recorded mic track ends mid-take (device unplugged / lost — common
      // with USB interfaces), stop cleanly so onstop fires and the partial take is
      // preserved in preview rather than silently vanishing.
      recordTrack.onended = () => {
        try { if (recorder.state !== 'inactive') recorder.stop() } catch { /* ok */ }
      }
      recorderRef.current = recorder

      setRecState('recording')
      applyMonitorGain()
      recorder.start(250)
      recordTimerRef.current = setInterval(() => {
        setRecordingSec(s => s + 0.25)
      }, 250)
    } catch (err) {
      // NOTHING in the record path is allowed to escape — an uncaught rejection
      // here previously crashed the route ("MediaStream is inactive").
      console.error('[RecordingTrackRow] start record failed:', err)
      countdownCancelRef.current?.()
      countdownCancelRef.current = null
      try { recordTrackRef.current?.stop() } catch { /* ok */ }
      recordTrackRef.current = null
      recorderRef.current = null
      // Only pause if WE started playback — pausing a never-started transport
      // corrupts its offset bookkeeping and teleports the playhead.
      if (playbackStarted) onPlaybackStop()
      setFrozenTimelineBars(null)
      setError(err instanceof Error && err.message === 'Microphone not available'
        ? 'Microphone not available'
        : 'Could not start recording')
      setRecState(isMicStreamLive(streamRef.current) ? 'armed' : 'idle')
    }
  }

  /** Shared teardown when a live take ends (Stop button, seek, pause, recorder
   *  self-stop). Transitions recording → preview and releases the mic. */
  function finalizeTake({ pausePlayback = true }: { pausePlayback?: boolean } = {}) {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
    try { recordTrackRef.current?.stop() } catch { /* ok */ }
    recordTrackRef.current = null
    if (pausePlayback) onPlaybackStop()
    stopStream()
    setFrozenTimelineBars(null)
    setRecState('preview')
  }
  const finalizeTakeRef = useRef(finalizeTake)
  finalizeTakeRef.current = finalizeTake

  /** Stop the current take from ANY trigger: Stop button, spacebar, mobile
   *  transport, timeline seek, transport pause, or end of the timeline.
   *  Also cancels a pending count-in. */
  function stopTake({ pausePlayback = true }: { pausePlayback?: boolean } = {}) {
    if (stateRef.current === 'countdown') {
      takeGenRef.current++
      countdownCancelRef.current?.()
      countdownCancelRef.current = null
      if (pausePlayback) onPlaybackStop()
      setFrozenTimelineBars(null)
      setRecState('armed')
      return
    }
    if (stateRef.current !== 'recording') return
    takeGenRef.current++
    const recorder = recorderRef.current
    recorderRef.current = null
    // Stop the recorder BEFORE its source track (finalizeTake) so the last
    // buffered chunk flushes cleanly. onstop fires as a macrotask, after
    // finalizeTake below has already set state 'preview' and bumped the take
    // generation, so it only runs processBlob — not a second teardown.
    try { if (recorder && recorder.state !== 'inactive') recorder.stop() } catch { /* ok */ }
    finalizeTake({ pausePlayback })
  }

  function handleStopRecord() {
    stopTake()
  }

  const handleStopRecordRef = useRef(stopTake)
  handleStopRecordRef.current = stopTake

  const handleArmRef = useRef(handleArm)
  handleArmRef.current = handleArm
  const handleStartRecordRef = useRef(handleStartRecord)
  handleStartRecordRef.current = handleStartRecord

  useEffect(() => {
    onStateChange?.(id, state)
  }, [id, state, onStateChange])

  useEffect(() => {
    if (!registerControl) return
    registerControl(id, {
      arm: (stream?: MediaStream) => handleArmRef.current(stream),
      startRecord: () => handleStartRecordRef.current(),
      stopRecord: () => handleStopRecordRef.current(),
      getState: () => stateRef.current,
    })
    return () => registerControl(id, null)
  }, [id, registerControl])

  // Global stop hook (spacebar, mobile transport). Registered during the
  // count-in too, so a take can be cancelled before it starts.
  useEffect(() => {
    if (!recordingStopRef || (state !== 'recording' && state !== 'countdown')) return
    recordingStopRef.current = () => { handleStopRecordRef.current() }
    return () => { recordingStopRef.current = null }
  }, [state, recordingStopRef])

  // ── Take must never outlive the transport ─────────────────────────────────
  // Any seek or pause while counting in or recording stops the take. Without
  // this, clicking the timeline or the transport stop button left the
  // MediaRecorder running invisibly.
  const takeActive = state === 'countdown' || state === 'recording'

  // Baselines captured at take start. Our own bar-snap seek in
  // handleStartRecord bumps seekEpoch in the same commit that enters
  // 'countdown', so reading the prop here already includes it.
  useEffect(() => {
    seenPlayingRef.current = false
    if (takeActive) seekEpochBaselineRef.current = seekEpoch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takeActive])

  useEffect(() => {
    if (!takeActive) return
    if (seekEpoch !== seekEpochBaselineRef.current) {
      // User seeked — kill the take but let playback continue from the new spot.
      handleStopRecordRef.current({ pausePlayback: false })
      return
    }
    if (isPlaying) {
      seenPlayingRef.current = true
      return
    }
    // Playback WAS running for this take and stopped (pause button, spacebar
    // fallback, end of timeline) — the take stops with it.
    if (seenPlayingRef.current) handleStopRecordRef.current({ pausePlayback: false })
  }, [takeActive, seekEpoch, isPlaying])

  // ── Auto-arm (fallback) ────────────────────────────────────────────────────
  // Prefer a stream prefetched in the "Record track" click (via registerControl).
  // That path keeps user activation so the permission prompt actually appears.
  // This effect only covers the case where another recording released, or the
  // prefetched arm missed (e.g. remount after permission already granted).
  // Declared AFTER registerControl so the prefetched arm wins the race.
  useEffect(() => {
    if (isActiveRecording || stateRef.current !== 'idle') return
    if (errorRef.current) return // denied / failed — user retries explicitly
    const t = window.setTimeout(() => {
      if (isActiveRecording || stateRef.current !== 'idle' || errorRef.current) return
      void handleArmRef.current()
    }, 0)
    return () => clearTimeout(t)
  }, [isActiveRecording])

  const previewMutedRef = useRef(previewMuted)
  previewMutedRef.current = previewMuted

  const onPreviewTimelineChangeRef = useRef(onPreviewTimelineChange)
  onPreviewTimelineChangeRef.current = onPreviewTimelineChange

  const notifyPreviewTimeline = useCallback((endSec: number | null) => {
    onPreviewTimelineChangeRef.current?.(id, endSec)
  }, [id])

  async function processBlob(mimeType: string) {
    const blob   = new Blob(chunksRef.current, { type: mimeType })
    const arrBuf = await blob.arrayBuffer()
    try {
      const ctx = new AudioContext()
      const decoded = await ctx.decodeAudioData(arrBuf.slice(0))
      await ctx.close()
      audioBufferRef.current = decoded
      setStaticBars(barsFromBuffer(decoded))
      setRecordedDurationSec(decoded.duration)
      const beatsPerBar = parseInt(timeSig.split('/')[0]) || 4
      const barDurSec = (60 / bpm) * beatsPerBar
      notifyPreviewTimeline(startBarRef.current * barDurSec + decoded.duration)
    } catch (e) {
      console.error('[RecordingTrackRow] decode failed:', e)
      setError('Could not decode recording')
      notifyPreviewTimeline(null)
    }
  }

  useEffect(() => {
    if (state !== 'preview' || !audioBufferRef.current || recordedDurationSec <= 0) return

    let cancelled = false

    const run = async () => {
      if (!isPlaying || previewMutedRef.current) {
        previewSrcRef.current?.stop()
        previewSrcRef.current = null
        return
      }

      const audioCtx = getSharedAudioContext()
      if (audioCtx.state === 'suspended') await audioCtx.resume()
      if (cancelled) return

      const beatsPerBar       = parseInt(timeSig.split('/')[0]) || 4
      const barDurSec         = (60 / bpm) * beatsPerBar
      const nudgeSec          = nudgeOffsetMs / 1000
      const recordingStartSec = startBarRef.current * barDurSec + nudgeSec
      const buf               = audioBufferRef.current
      if (!buf) return
      const recordingEndSec   = recordingStartSec + buf.duration
      const playNowSec        = getPlaybackMs() / 1000

      previewSrcRef.current?.stop()
      previewSrcRef.current = null

      if (playNowSec < recordingEndSec) {
        const src = audioCtx.createBufferSource()
        src.buffer = buf
        // Route through the take-gain node so the Vol slider shapes the preview
        // exactly like the saved WAV. Slider changes update the node directly
        // (no source restart needed).
        const gainNode = audioCtx.createGain()
        gainNode.gain.value = takeGainRef.current
        src.connect(gainNode)
        gainNode.connect(getMasterOutput())
        previewGainRef.current = gainNode

        const acxNow  = audioCtx.currentTime
        const acxZero = acxNow - playNowSec

        if (playNowSec < recordingStartSec) {
          src.start(acxZero + recordingStartSec, 0)
        } else {
          src.start(acxNow, playNowSec - recordingStartSec)
        }
        previewSrcRef.current = src
      }
    }

    void run()

    return () => {
      cancelled = true
      try { previewSrcRef.current?.stop() } catch { /* ok */ }
      previewSrcRef.current = null
      try { previewGainRef.current?.disconnect() } catch { /* ok */ }
      previewGainRef.current = null
    }
  }, [isPlaying, seekEpoch, state, previewMuted, recordedDurationSec, nudgeOffsetMs, bpm, timeSig, getPlaybackMs])

  useEffect(() => {
    if (state !== 'preview' || !audioBufferRef.current || recordedDurationSec <= 0) return
    const beatsPerBar = parseInt(timeSig.split('/')[0]) || 4
    const barDurSec = (60 / bpm) * beatsPerBar
    const effectiveStartSec = startBarRef.current * barDurSec + nudgeOffsetMs / 1000
    onPreviewTimelineChangeRef.current?.(id, effectiveStartSec + audioBufferRef.current.duration)
  }, [state, nudgeOffsetMs, recordedDurationSec, bpm, timeSig, id])

  async function handleReRecord() {
    try { previewSrcRef.current?.stop() } catch { /* ok */ }
    previewSrcRef.current = null
    audioBufferRef.current = null
    notifyPreviewTimeline(null)
    chunksRef.current = []
    setStaticBars([])
    setRecordedDurationSec(0)
    setRecordingSec(0)
    setRecordingBars([])
    setNudgeOffsetMs(0)
    setTakeGain(1)
    setFrozenTimelineBars(null)
    setRecState('armed')
    const gen = armGenRef.current
    try {
      const stream = await acquireMic(selectedDevice, gen)
      if (stream) {
        void startMeter(stream)
      }
    } catch { /* ok */ }
  }

  async function handleSave() {
    const decoded = audioBufferRef.current
    if (!decoded) return
    setRecState('saving')
    setError('')
    setUploadProgress(0)
    try { previewSrcRef.current?.stop() } catch { /* ok */ }
    previewSrcRef.current = null
    notifyPreviewTimeline(null)
    try {
      // Bake nudge + take volume into the file so the saved track plays back
      // exactly as previewed.
      const adjusted = applyGainToBuffer(applyNudgeToBuffer(decoded, nudgeOffsetMs), takeGain)
      const wavBlob  = encodeWAV(adjusted, 0)
      const safeName = editName.replace(/[^a-z0-9\s-]/gi, '').trim() || 'New recording'
      const filename = `${safeName.replace(/\s+/g, '_')}_${Date.now()}.wav`

      const presignRes = await fetch(`/api/versions/${versionId}/tracks/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, fileSize: wavBlob.size, contentType: 'audio/wav' }),
      })
      if (!presignRes.ok) throw new Error(`Presign ${presignRes.status}`)
      const { presignedUrl, tempKey } = await presignRes.json()

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.upload.addEventListener('progress', e => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100))
        })
        xhr.addEventListener('load', () =>
          xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload ${xhr.status}`)),
        )
        xhr.addEventListener('error', () => reject(new Error('Network error')))
        xhr.open('PUT', presignedUrl)
        xhr.setRequestHeader('Content-Type', 'audio/wav')
        xhr.send(wavBlob)
      })

      const processRes = await fetch(`/api/versions/${versionId}/tracks/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tempKey,
          originalFilename: filename,
          fileSize: wavBlob.size,
          mimetype: 'audio/wav',
          startBar: startBarRef.current,
          durationMs: Math.round(adjusted.duration * 1000),
        }),
      })
      if (!processRes.ok) throw new Error(`Process ${processRes.status}`)
      const { track } = await processRes.json()

      // Seed the waveform cache so the regular TrackRow renders the bars immediately
      // (without waiting for the audio stream to re-download and decode).
      waveformBarsCache.set(track.id, barsFromBuffer(adjusted))
      onRelease(id)
      onSaved(id, track)
    } catch (err) {
      console.error('[RecordingTrackRow] save error:', err)
      setError(err instanceof Error ? err.message : String(err))
      setRecState('preview')
    }
  }

  function handleDiscard() {
    trackEvent('recording_discarded')
    void handleReRecord()
  }

  function handleDelete() {
    armGenRef.current++
    takeGenRef.current++
    countdownCancelRef.current?.()
    countdownCancelRef.current = null
    try { previewSrcRef.current?.stop() } catch { /* ok */ }
    const recorder = recorderRef.current
    recorderRef.current = null
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.onerror = null
      try { if (recorder.state !== 'inactive') recorder.stop() } catch { /* ok */ }
    }
    try { recordTrackRef.current?.stop() } catch { /* ok */ }
    recordTrackRef.current = null
    stopStream()
    notifyPreviewTimeline(null)
    onRelease(id)
    onDelete(id)
  }

  const isIdle       = state === 'idle'
  const isPermitting = state === 'permitting'
  const isArmed      = state === 'armed'
  const isCounting   = state === 'countdown'
  const isRecording  = state === 'recording'
  const isPreview    = state === 'preview'
  const isSaving     = state === 'saving'
  const showControls = isArmed || isCounting || isRecording
  const showLiveMeter = isArmed || isCounting || isRecording

  const beatsPerBarDerived = parseInt(timeSig.split('/')[0]) || 4
  const barDurSec   = (60 / bpm) * beatsPerBarDerived
  const recordedBars = recordedDurationSec > 0 ? recordedDurationSec / barDurSec : 0
  const liveRecordedBars = recordingSec > 0 ? recordingSec / barDurSec : 0
  const timelineStartBar = isRecording || isPreview || isSaving ? recordStartBar : armedAtBar
  const nudgeBarOffset = (isPreview || isSaving) ? nudgeOffsetMs / 1000 / barDurSec : 0
  const visualStartBar = timelineStartBar + nudgeBarOffset
  const playheadBar = barDurSec > 0 ? Math.ceil(getPlaybackMs() / 1000 / barDurSec) : 0
  const contentEndBar = visualStartBar + (isRecording ? liveRecordedBars : recordedBars) + 4
  const naturalTimelineBars = Math.max(totalBars, playheadBar + 4, Math.ceil(contentEndBar))
  // While recording, use the width snapshot taken at take start (see handleStartRecord).
  // Otherwise the growing take and advancing playhead keep expanding the timeline,
  // rescaling the whole waveform and shifting its anchor mid-take. The frozen width
  // keeps bars a constant size, pinned to where they're recorded, with the right edge
  // tracking the playhead.
  const timelineBars = isRecording && frozenTimelineBars != null
    ? frozenTimelineBars
    : naturalTimelineBars
  const waveformLeft = timelineBars > 0
    ? `${(visualStartBar / timelineBars) * 100}%`
    : '0'
  const waveformWidth = timelineBars > 0
    ? `${Math.min(100, Math.max((1 / timelineBars) * 100, ((isRecording ? liveRecordedBars : recordedBars) / timelineBars) * 100))}%`
    : '100%'
  const oneBarWidthPct = timelineBars > 0 ? `${Math.max((1 / timelineBars) * 100, 1.5)}%` : '4%'
  const liveMeterWidth = isRecording ? waveformWidth : oneBarWidthPct
  const showRecordedWaveform = (isPreview || isSaving) && staticBars.length > 0
  const showLiveSpectrum = showLiveMeter && isRecording && recordingBars.length > 0
  const showLiveVolumeBar = showLiveMeter && !showLiveSpectrum
  // Match the visual bar density of other tracks (96 bars across the full row).
  // Recording spans recordedBars/totalBars of the row → scale proportionally.
  const previewBarCount = Math.max(4, Math.round(BAR_COUNT * (recordedBars / Math.max(1, timelineBars))))
  // Same density formula for the live take. Because the bar count and the
  // waveform width both scale with elapsed recording time, each bar keeps a
  // constant width and the right edge stays glued to the moving playhead.
  const liveBarCount = Math.max(4, Math.round(BAR_COUNT * (liveRecordedBars / Math.max(1, timelineBars))))

  const showDeviceSelect = devices.length > 0 && (isArmed || isCounting || isRecording)

  const mobileTimelineWidthPct = Math.max(
    MOBILE_TIMELINE_MIN_WIDTH_PCT,
    timelineBars * MOBILE_TIMELINE_PCT_PER_BAR,
  )

  const scrollTimelineToBar = useCallback((bar: number) => {
    const scrollEl = waveformScrollRef.current
    if (!scrollEl || timelineBars <= 0) return
    const inner = scrollEl.firstElementChild as HTMLElement | null
    if (!inner) return
    const focusPx = (bar / timelineBars) * inner.offsetWidth
    const viewLeft = scrollEl.scrollLeft
    const viewRight = viewLeft + scrollEl.clientWidth
    let nextScroll = scrollEl.scrollLeft
    if (focusPx > viewRight - TIMELINE_SCROLL_RIGHT_PAD_PX) {
      nextScroll = Math.min(
        focusPx - scrollEl.clientWidth + TIMELINE_SCROLL_RIGHT_PAD_PX,
        scrollEl.scrollWidth - scrollEl.clientWidth,
      )
    } else if (focusPx < viewLeft + TIMELINE_SCROLL_LEFT_PAD_PX) {
      nextScroll = Math.max(0, focusPx - TIMELINE_SCROLL_LEFT_PAD_PX)
    }
    if (nextScroll !== scrollEl.scrollLeft) {
      scrollEl.scrollLeft = nextScroll
      scrollSync?.syncTo(nextScroll, scrollEl)
    }
  }, [timelineBars, scrollSync])

  // Keep armed / recording / preview clip visible on the mobile scrollable timeline.
  useEffect(() => {
    if (!mobileScrollableTimeline) return
    const focusBar = isPreview || isSaving
      ? timelineStartBar
      : (isRecording || isCounting ? recordStartBar : timelineStartBar)
    scrollTimelineToBar(focusBar)
  }, [
    mobileScrollableTimeline,
    scrollTimelineToBar,
    timelineBars,
    timelineStartBar,
    recordStartBar,
    isRecording,
    isCounting,
    isPreview,
    isSaving,
    armedAtBar,
    staticBars.length,
    recordingBars.length,
  ])

  const waveformCol = (
    <>
      {mobileScrollableTimeline ? (
        <MobileTimelineGrid totalBars={timelineBars} />
      ) : (
        <TactGrid totalBars={timelineBars} />
      )}

      {showLiveVolumeBar && (
        <LiveVolumeBar
          level={inputLevel}
          pulsing={isRecording || isCounting}
          leftPct={waveformLeft}
          widthPct={liveMeterWidth}
        />
      )}

      {showLiveSpectrum && (
        <BarWaveform
          bars={recordingBars}
          leftPct={waveformLeft}
          widthPct={waveformWidth}
          opacity={0.95}
          barCount={liveBarCount}
        />
      )}

      {showRecordedWaveform && (
        <BarWaveform
          bars={staticBars}
          leftPct={waveformLeft}
          widthPct={waveformWidth}
          opacity={isSaving ? 0.45 : 0.95}
          barCount={previewBarCount}
          animate={isPreview}
        />
      )}

      {isPreview && !showRecordedWaveform && recordingBars.length > 0 && (
        <BarWaveform
          bars={recordingBars}
          leftPct={waveformLeft}
          widthPct={waveformWidth}
          barCount={previewBarCount}
          animate
        />
      )}

      {isSaving && (
        <div className="absolute inset-0 flex items-center justify-center z-[3]">
          <span className="text-[9px] uppercase tracking-widest text-lime">
            {uploadProgress > 0 ? `${uploadProgress}%` : 'Saving…'}
          </span>
        </div>
      )}
    </>
  )

  const rowBg = isRecording
    ? 'color-mix(in srgb, var(--lime) 5%, var(--surface))'
    : 'var(--surface)'

  const nameRow = (
    <div className="flex items-center gap-1.5 min-w-0">
      {(isRecording || isCounting) && (
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ background: '#ef4444', animation: 'recPulse 1s ease-in-out infinite' }}
        />
      )}
      <input
        type="text"
        value={editName}
        onChange={e => { setEditName(e.target.value); onNameChange(id, e.target.value) }}
        disabled={isRecording || isCounting || isSaving}
        className="min-w-0 flex-1 bg-transparent text-xs font-bold uppercase tracking-tight text-foreground outline-none border-b border-transparent focus:border-lime truncate"
        placeholder="New recording"
      />
      <button
        type="button"
        onClick={handleDelete}
        className="shrink-0 text-muted-foreground hover:text-destructive text-xs transition"
        aria-label="Close recording"
      >
        ✕
      </button>
    </div>
  )

  const controlsBlock = (
    <>
      {isIdle && !error && isActiveRecording && (
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
          Waiting — another recording is active
        </span>
      )}
      {isIdle && error && (
        <button
          type="button"
          onClick={() => { setError(''); void handleArm() }}
          className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-muted-foreground hover:text-lime transition w-fit"
        >
          <span className="inline-block w-2 h-2 rounded-full shrink-0 bg-destructive" />
          Retry mic
        </button>
      )}
      {isPermitting && (
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Requesting mic…</span>
      )}
      {isIdle && !error && !isActiveRecording && (
        <button
          type="button"
          onClick={() => { void handleArm() }}
          className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-muted-foreground hover:text-lime transition w-fit"
        >
          <span className="inline-block w-2 h-2 rounded-full shrink-0 bg-destructive" />
          Enable mic
        </button>
      )}
      {showDeviceSelect && (
        <select
          value={selectedDevice}
          onChange={e => handleDeviceChange(e.target.value)}
          disabled={isRecording || isCounting}
          className={`text-[9px] bg-surface border border-border text-foreground px-1 py-0.5 truncate ${mobileScrollableTimeline ? 'max-w-[10rem]' : 'w-full'}`}
        >
          {devices.map(d => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Mic ${d.deviceId.slice(0, 4)}`}
            </option>
          ))}
        </select>
      )}
      {isArmed && (
        <button
          type="button"
          onClick={() => void handleStartRecord()}
          className="flex items-center gap-1 text-[9px] uppercase tracking-widest font-semibold w-fit"
          style={{ color: '#ef4444' }}
        >
          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: '#ef4444' }} />
          Rec
        </button>
      )}
      {isCounting && (
        <button
          type="button"
          onClick={() => handleStopRecordRef.current()}
          className="text-[9px] uppercase tracking-widest text-amber hover:text-foreground w-fit"
          title="Cancel count-in"
        >
          Count-in… ✕
        </button>
      )}
      {isRecording && (
        <button
          type="button"
          onClick={handleStopRecord}
          className="flex items-center gap-1 text-[9px] uppercase tracking-widest font-semibold w-fit"
          style={{ color: '#ef4444' }}
        >
          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: '#ef4444' }} />
          Stop
        </button>
      )}
      {isPreview && (
        <div className="flex flex-col gap-1.5 w-full min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setPreviewMuted(m => !m)}
              className="text-[9px] uppercase tracking-widest"
              style={{ color: previewMuted ? 'var(--lime)' : 'var(--muted-foreground)' }}
            >
              {previewMuted ? 'Muted' : 'Mute'}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              className="text-[9px] uppercase tracking-widest font-semibold text-lime"
            >
              Save
            </button>
            <button
              type="button"
              onClick={handleDiscard}
              className="text-[9px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              Discard
            </button>
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[9px] uppercase tracking-widest text-muted-foreground shrink-0">Vol</span>
            <input
              type="range"
              min={0}
              max={3}
              step={0.01}
              value={takeGain}
              onChange={e => {
                const v = parseFloat(e.target.value)
                setTakeGain(v)
                // Live-update the preview without restarting the source.
                if (previewGainRef.current) previewGainRef.current.gain.value = v
              }}
              className="flex-1 min-w-0 accent-lime"
              aria-label="Take volume (applied on save)"
            />
            <span className="text-[9px] tabular-nums text-muted-foreground shrink-0 w-9 text-right">
              {Math.round(takeGain * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="-10ms"
              onClick={() => setNudgeOffsetMs(ms => ms - 10)}
              className="size-5 flex items-center justify-center text-muted-foreground hover:text-foreground border border-border hover:border-lime transition"
              aria-label="Nudge 10ms earlier"
            >
              <NudgeArrowIcon direction="left" />
            </button>
            <button
              type="button"
              title="+10ms"
              onClick={() => setNudgeOffsetMs(ms => ms + 10)}
              className="size-5 flex items-center justify-center text-muted-foreground hover:text-foreground border border-border hover:border-lime transition"
              aria-label="Nudge 10ms later"
            >
              <NudgeArrowIcon direction="right" />
            </button>
            {nudgeOffsetMs !== 0 && (
              <span className="text-[9px] tabular-nums text-muted-foreground">
                {nudgeOffsetMs > 0 ? `+${nudgeOffsetMs}` : nudgeOffsetMs}ms
              </span>
            )}
          </div>
        </div>
      )}
      {isSaving && (
        <span className="text-[9px] uppercase tracking-widest text-lime">
          {uploadProgress > 0 ? `Saving ${uploadProgress}%…` : 'Saving…'}
        </span>
      )}
      {showControls && (
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground shrink-0">Mon</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={monitorVol}
            onChange={e => handleMonitorChange(parseFloat(e.target.value))}
            disabled={isRecording}
            className="flex-1 min-w-0 accent-lime"
            aria-label="Input monitor level"
          />
          <span className="text-[9px] tabular-nums text-muted-foreground shrink-0 w-8 text-right">
            {isRecording ? '0%' : `${Math.round(monitorVol * 100)}%`}
          </span>
        </div>
      )}
      {showControls && (
        <p className="text-[8px] leading-tight text-muted-foreground opacity-60 m-0">
          {isArmed ? 'Mic ready' : isRecording ? 'Recording — monitor muted' : 'Count-in…'}
        </p>
      )}
      {error && (
        <span className="text-[9px] truncate text-destructive">{error}</span>
      )}
    </>
  )

  const pulseStyle = (
    <style>{`
      @keyframes recPulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.35; }
      }
    `}</style>
  )

  if (mobileScrollableTimeline) {
    return (
      <div
        data-track-row
        data-recording-id={id}
        className="relative border-b border-border"
        style={{ background: rowBg }}
      >
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-destructive/80" />
        <div className="pl-3 pr-2 py-2.5">
          {nameRow}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {controlsBlock}
          </div>
          {timelineStartBar > 0 && (
            <div className="mt-1 text-[9px] font-mono text-muted-foreground">
              Bar {timelineStartBar + 1}
              {nudgeOffsetMs !== 0 && (
                <span className="ml-1 tabular-nums">
                  ({nudgeOffsetMs > 0 ? '+' : ''}{nudgeOffsetMs}ms)
                </span>
              )}
            </div>
          )}
        </div>
        <div
          ref={waveformScrollRef}
          data-waveform-col
          className="px-3 pb-2.5 overflow-x-auto scrollbar-none touch-pan-x"
        >
          <div
            className="relative bg-surface/40 border border-border"
            style={{ width: `${mobileTimelineWidthPct}%`, minHeight: 67 }}
          >
            {waveformCol}
          </div>
        </div>
        {pulseStyle}
      </div>
    )
  }

  return (
    <div
      data-track-row
      data-recording-id={id}
      className="flex border-t border-border"
      style={{ minHeight: TRACK_ROW_H, background: rowBg }}
    >
      <div
        className="shrink-0 border-r border-border flex flex-col justify-between py-2 px-3"
        style={{ width: TRACK_LABEL_W }}
      >
        <div className="mb-1 min-w-0">{nameRow}</div>
        <div className="flex flex-col gap-1.5 min-w-0">{controlsBlock}</div>
      </div>

      <div
        data-waveform-col
        className="flex-1 min-w-0 relative overflow-hidden border-l border-border/0"
        style={{ minHeight: TRACK_ROW_H }}
      >
        {waveformCol}
      </div>

      {pulseStyle}
    </div>
  )
})
