'use client'

import { useRef, useState, useEffect, useCallback, memo, type MutableRefObject } from 'react'
import type { Track } from '@/lib/types'
import { getSharedAudioContext, getMasterOutput } from '@/lib/audioContext'
import { getRecordingAudioContext, resumeRecordingAudioContext } from '@/lib/recordingAudioContext'
import { TactGrid } from '@/components/design/TactGrid'
import { snapToPreviousBarSec, barDurationSec } from '@/lib/metronomeAudio'
import { waveformBarsCache } from '@/lib/waveformCache'

const TRACK_LABEL_W = 192
const WAVEFORM_COLOR = 'var(--ember, #e07a5f)'
const BAR_COUNT = 96
const LIVE_MONITOR_BARS = 28
const METER_RENDER_MS = 70

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

function downsampleBars(bars: number[], target = BAR_COUNT): number[] {
  if (bars.length <= target) return bars
  const out: number[] = []
  const step = bars.length / target
  for (let i = 0; i < target; i++) {
    const start = Math.floor(i * step)
    const end = Math.min(bars.length, Math.floor((i + 1) * step))
    let peak = 0
    for (let j = start; j < end; j++) peak = Math.max(peak, bars[j])
    out.push(peak)
  }
  const max = Math.max(...out, 0.001)
  return out.map(v => v / max)
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
  bars, leftPct, widthPct, opacity = 0.95, minBarPct = 8, bottom = false,
  animate = false, barCount = BAR_COUNT,
}: {
  bars: number[]
  leftPct: string
  widthPct: string
  opacity?: number
  minBarPct?: number
  bottom?: boolean
  animate?: boolean
  barCount?: number
}) {
  if (!bars.length) return null
  const display = downsampleBars(bars, barCount)
  return (
    <div
      className={bottom
        ? 'absolute bottom-3 flex items-end gap-px z-[2]'
        : 'absolute top-2 bottom-2 flex items-center gap-px px-1 z-[2]'}
      style={{ left: leftPct, width: widthPct, opacity, height: bottom ? 32 : undefined, minWidth: bottom ? 24 : undefined }}
    >
      {display.map((h, i) => (
        <div
          key={i}
          className={`flex-1 min-w-0${animate ? ' animate-draw-wave' : ''}`}
          style={{
            height: `${Math.max(minBarPct, h * 100)}%`,
            background: WAVEFORM_COLOR,
            animationDelay: animate ? `${i * 4}ms` : undefined,
          }}
        />
      ))}
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
          background: 'var(--ember)',
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
  const [monitorVol, setMonitorVol] = useState(0)
  const [previewMuted, setPreviewMuted] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError]           = useState('')
  const [editName, setEditName]     = useState(name)
  const [recordedDurationSec, setRecordedDurationSec] = useState(0)
  const [recordingSec, setRecordingSec] = useState(0)
  const [staticBars, setStaticBars] = useState<number[]>([])
  const [liveBars, setLiveBars] = useState<number[]>(() => Array(LIVE_MONITOR_BARS).fill(0))
  const [recordingBars, setRecordingBars] = useState<number[]>([])
  const [inputLevel, setInputLevel] = useState(0)
  const [recordStartBar, setRecordStartBar] = useState(0)
  const [armedAtBar, setArmedAtBar] = useState(0)
  const [nudgeOffsetMs, setNudgeOffsetMs] = useState(0)

  const streamRef       = useRef<MediaStream | null>(null)
  const recorderRef     = useRef<MediaRecorder | null>(null)
  const chunksRef       = useRef<Blob[]>([])
  const audioBufferRef  = useRef<AudioBuffer | null>(null)
  const startBarRef     = useRef(0)
  const previewSrcRef   = useRef<AudioBufferSourceNode | null>(null)
  const recordTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const armGenRef       = useRef(0)
  const armInFlightRef  = useRef(false)
  const stateRef        = useRef<RecordState>('idle')
  stateRef.current = state
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

  const startMeter = useCallback(async (stream: MediaStream) => {
    stopMeter()
    const ctx = await resumeRecordingAudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.3
    // Route source → analyser → monitorGain → destination.
    // This keeps the graph pulled (so the analyser gets data) and provides
    // low-latency Web Audio monitoring — no <audio> element buffering involved.
    const monGain = ctx.createGain()
    monGain.gain.value = monitorVolRef.current
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
      const an = meterAnalyserRef.current
      const buf = meterDataRef.current
      if (!an || !buf) return

      an.getFloatTimeDomainData(buf)
      let peak = 0
      for (let i = 0; i < buf.length; i++) {
        const abs = Math.abs(buf[i])
        if (abs > peak) peak = abs
      }
      const level = Math.min(1, peak * 1.8)
      setInputLevel(level)

      if (now - lastMeterRenderRef.current < METER_RENDER_MS) return
      lastMeterRenderRef.current = now

      if (stateRef.current === 'recording') {
        setRecordingBars(prev => [...prev, level])
      } else {
        setLiveBars(prev => {
          const next = prev.length >= LIVE_MONITOR_BARS ? prev.slice(1) : [...prev]
          next.push(level)
          return next
        })
      }
    }
    meterRafRef.current = requestAnimationFrame(tick)
  }, [stopMeter])

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
    const audio: MediaTrackConstraints = {
      deviceId: deviceId ? { ideal: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: { ideal: 22050 },
      channelCount: { ideal: 1 },
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false })
    if (gen !== armGenRef.current) {
      stream.getTracks().forEach(t => t.stop())
      return null
    }
    streamRef.current = stream
    return stream
  }, [stopStream])

  async function handleArm(prefetchedStream?: MediaStream) {
    if (armInFlightRef.current) return
    if (stateRef.current !== 'idle') return
    if (isActiveRecording) return

    armInFlightRef.current = true
    const gen = ++armGenRef.current
    if (!prefetchedStream) setState('permitting')
    setError('')

    try {
      const stream = prefetchedStream
        ?? await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      if (gen !== armGenRef.current) {
        stream.getTracks().forEach(t => t.stop())
        return
      }

      // Yield — do not touch Web Audio or <audio> in the permission callback tick.
      if (!prefetchedStream) {
        await new Promise<void>(resolve => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        })
        if (gen !== armGenRef.current) {
          stream.getTracks().forEach(t => t.stop())
          return
        }
      }

      streamRef.current = stream
      setState('armed')
      onArm(id)

      window.setTimeout(() => {
        if (gen === armGenRef.current && streamRef.current === stream) {
          void startMeter(stream)
        }
      }, 200)

      window.setTimeout(() => {
        if (gen !== armGenRef.current || !streamRef.current) return
        void navigator.mediaDevices.enumerateDevices()
          .then(all => {
            if (gen !== armGenRef.current) return
            const audioIns = all.filter(d => d.kind === 'audioinput')
            setDevices(audioIns)
            const activeId = streamRef.current?.getAudioTracks()[0]?.getSettings().deviceId ?? ''
            if (activeId) setSelectedDevice(activeId)
          })
          .catch(() => {})
      }, 400)
    } catch {
      if (gen === armGenRef.current) {
        setError('Mic access denied')
        setState('idle')
      }
    } finally {
      armInFlightRef.current = false
    }
  }

  useEffect(() => {
    return () => {
      armGenRef.current++
      previewSrcRef.current?.stop()
      recorderRef.current?.stop()
      stopStream()
    }
  }, [stopStream])

  // Live input meter — isolated context, deferred after mic is stable.
  useEffect(() => {
    const active = state === 'armed' || state === 'countdown' || state === 'recording'
    if (!active || !streamRef.current) {
      stopMeter()
      return
    }
    const stream = streamRef.current
    const t = window.setTimeout(() => {
      if (streamRef.current === stream) void startMeter(stream)
    }, 150)
    return () => {
      clearTimeout(t)
      stopMeter()
    }
  }, [state, startMeter, stopMeter])

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
    setMonitorVol(vol)
    // Update the Web Audio monitor gain in real-time — no restart needed.
    if (meterMonitorRef.current) meterMonitorRef.current.gain.value = vol
  }

  async function handleStartRecord() {
    if (stateRef.current !== 'armed' && stateRef.current !== 'countdown') return
    setError('')

    if (!streamRef.current) {
      const gen = armGenRef.current
      try {
        const stream = await acquireMic(selectedDevice, gen)
        if (!stream) {
          setError('Microphone not available')
          return
        }
      } catch {
        setError('Microphone not available')
        return
      }
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

    setState('countdown')
    const { promise, takeStartTime } = await playCountdown(bpm, timeSig)
    onPlaybackStart(takeStartTime)

    startBarRef.current = snapBar
    setRecordStartBar(snapBar)

    const stream = streamRef.current
    if (!stream) {
      setError('Microphone not available')
      setState('armed')
      return
    }

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/mp4'

    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 })
    } catch {
      try {
        recorder = new MediaRecorder(stream, { mimeType })
      } catch {
        setError('Recording not supported in this browser')
        setState('armed')
        return
      }
    }

    chunksRef.current = []
    setRecordingSec(0)
    setRecordingBars([])
    setLiveBars(Array(LIVE_MONITOR_BARS).fill(0))
    setNudgeOffsetMs(0)

    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    recorder.onstop = () => { void processBlob(mimeType) }
    recorderRef.current = recorder

    await promise

    setState('recording')
    recorder.start(250)
    recordTimerRef.current = setInterval(() => {
      setRecordingSec(s => s + 0.25)
    }, 250)
  }

  function handleStopRecord() {
    if (stateRef.current !== 'recording') return
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
    recorderRef.current?.stop()
    recorderRef.current = null
    onPlaybackStop()
    stopStream()
    setState('preview')
  }

  const handleStopRecordRef = useRef(handleStopRecord)
  handleStopRecordRef.current = handleStopRecord

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

  useEffect(() => {
    if (!recordingStopRef || state !== 'recording') return
    recordingStopRef.current = () => { handleStopRecordRef.current() }
    return () => { recordingStopRef.current = null }
  }, [state, recordingStopRef])

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
        src.connect(getMasterOutput())

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
      previewSrcRef.current?.stop()
      previewSrcRef.current = null
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
    previewSrcRef.current?.stop()
    previewSrcRef.current = null
    audioBufferRef.current = null
    notifyPreviewTimeline(null)
    chunksRef.current = []
    setStaticBars([])
    setRecordedDurationSec(0)
    setRecordingSec(0)
    setRecordingBars([])
    setLiveBars(Array(LIVE_MONITOR_BARS).fill(0))
    setNudgeOffsetMs(0)
    setState('armed')
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
    setState('saving')
    setError('')
    setUploadProgress(0)
    previewSrcRef.current?.stop()
    previewSrcRef.current = null
    notifyPreviewTimeline(null)
    try {
      const adjusted = applyNudgeToBuffer(decoded, nudgeOffsetMs)
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
      setState('preview')
    }
  }

  function handleDiscard() {
    void handleReRecord()
  }

  function handleDelete() {
    previewSrcRef.current?.stop()
    recorderRef.current?.stop()
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
  const timelineBars = Math.max(totalBars, playheadBar + 4, Math.ceil(contentEndBar))
  const waveformLeft = timelineBars > 0
    ? `${(visualStartBar / timelineBars) * 100}%`
    : '0'
  const waveformWidth = timelineBars > 0
    ? `${Math.min(100, Math.max((1 / timelineBars) * 100, ((isRecording ? liveRecordedBars : recordedBars) / timelineBars) * 100))}%`
    : '100%'
  const oneBarWidthPct = timelineBars > 0 ? `${Math.max((1 / timelineBars) * 100, 1.5)}%` : '4%'
  const liveMeterWidth = isRecording ? waveformWidth : oneBarWidthPct
  const liveSpectrumBars = isRecording
    ? recordingBars
    : (liveBars.some(v => v > 0.02) ? liveBars : [inputLevel])
  const showRecordedWaveform = (isPreview || isSaving) && staticBars.length > 0
  const showLiveSpectrum = showLiveMeter && isRecording && recordingBars.length > 0
  const showLiveVolumeBar = showLiveMeter && !showLiveSpectrum
  // Match the visual bar density of other tracks (96 bars across the full row).
  // Recording spans recordedBars/totalBars of the row → scale proportionally.
  const previewBarCount = Math.max(4, Math.round(BAR_COUNT * (recordedBars / Math.max(1, timelineBars))))
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
    if (focusPx > viewRight - TIMELINE_SCROLL_RIGHT_PAD_PX) {
      scrollEl.scrollLeft = Math.min(
        focusPx - scrollEl.clientWidth + TIMELINE_SCROLL_RIGHT_PAD_PX,
        scrollEl.scrollWidth - scrollEl.clientWidth,
      )
    } else if (focusPx < viewLeft + TIMELINE_SCROLL_LEFT_PAD_PX) {
      scrollEl.scrollLeft = Math.max(0, focusPx - TIMELINE_SCROLL_LEFT_PAD_PX)
    }
  }, [timelineBars])

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
          bars={liveSpectrumBars}
          leftPct={waveformLeft}
          widthPct={liveMeterWidth}
          opacity={0.9}
          minBarPct={8}
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
          <span className="text-[9px] uppercase tracking-widest text-ember">
            {uploadProgress > 0 ? `${uploadProgress}%` : 'Saving…'}
          </span>
        </div>
      )}
    </>
  )

  const rowBg = isRecording
    ? 'color-mix(in srgb, var(--ember) 5%, var(--surface))'
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
        className="min-w-0 flex-1 bg-transparent text-xs font-bold uppercase tracking-tight text-foreground outline-none border-b border-transparent focus:border-ember truncate"
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
      {isIdle && (
        <button
          type="button"
          onClick={() => void handleArm()}
          disabled={isActiveRecording}
          className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-muted-foreground hover:text-ember disabled:opacity-30 transition w-fit"
        >
          <span className="inline-block w-2 h-2 rounded-full shrink-0 bg-destructive" />
          Arm
        </button>
      )}
      {isPermitting && (
        <span className="text-[9px] uppercase tracking-widest text-muted-foreground">Requesting mic…</span>
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
        <span className="text-[9px] uppercase tracking-widest text-amber">Count-in…</span>
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
        <>
          <button
            type="button"
            onClick={() => setPreviewMuted(m => !m)}
            className="text-[9px] uppercase tracking-widest"
            style={{ color: previewMuted ? 'var(--ember)' : 'var(--muted-foreground)' }}
          >
            {previewMuted ? 'Muted' : 'Mute'}
          </button>
          <button type="button" onClick={() => void handleSave()}
            className="text-[9px] uppercase tracking-widest font-semibold text-ember">
            Save
          </button>
          <button type="button" onClick={handleDiscard}
            className="text-[9px] uppercase tracking-widest text-muted-foreground hover:text-foreground">
            Discard
          </button>
          <button
            type="button"
            title="-10ms"
            onClick={() => setNudgeOffsetMs(ms => ms - 10)}
            className="size-5 flex items-center justify-center text-muted-foreground hover:text-foreground border border-border hover:border-ember transition"
            aria-label="Nudge 10ms earlier"
          >
            <NudgeArrowIcon direction="left" />
          </button>
          <button
            type="button"
            title="+10ms"
            onClick={() => setNudgeOffsetMs(ms => ms + 10)}
            className="size-5 flex items-center justify-center text-muted-foreground hover:text-foreground border border-border hover:border-ember transition"
            aria-label="Nudge 10ms later"
          >
            <NudgeArrowIcon direction="right" />
          </button>
          {nudgeOffsetMs !== 0 && (
            <span className="text-[9px] tabular-nums text-muted-foreground">
              {nudgeOffsetMs > 0 ? `+${nudgeOffsetMs}` : nudgeOffsetMs}ms
            </span>
          )}
        </>
      )}
      {isSaving && (
        <span className="text-[9px] uppercase tracking-widest text-ember">
          {uploadProgress > 0 ? `Saving ${uploadProgress}%…` : 'Saving…'}
        </span>
      )}
      {showControls && !mobileScrollableTimeline && (
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
            className="flex-1 min-w-0 accent-ember"
          />
        </div>
      )}
      {showControls && !mobileScrollableTimeline && (
        <p className="text-[8px] leading-tight text-muted-foreground opacity-60 m-0">
          {isArmed ? 'Mic ready' : isRecording ? 'Recording…' : 'Demo quality · mono'}
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
            className="relative h-14 bg-surface/40 border border-border"
            style={{ width: `${mobileTimelineWidthPct}%`, minHeight: 56 }}
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
      style={{ minHeight: 80, background: rowBg }}
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
        style={{ minHeight: 80 }}
      >
        {waveformCol}
      </div>

      {pulseStyle}
    </div>
  )
})
