'use client'

import { useRef, useState, useEffect, useCallback, memo } from 'react'
import type { Track } from '@/lib/types'
import { getSharedAudioContext, getMasterOutput } from '@/lib/audioContext'
import { getRecordingAudioContext, resumeRecordingAudioContext } from '@/lib/recordingAudioContext'
import { TactGrid } from '@/components/design/TactGrid'
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
  level, pulsing = false,
}: {
  level: number
  pulsing?: boolean
}) {
  return (
    <div
      className="absolute left-0 right-0 z-[2]"
      style={{ bottom: 12, height: 5 }}
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

type RecordState = 'idle' | 'permitting' | 'armed' | 'countdown' | 'recording' | 'preview' | 'saving'

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
  isActiveRecording: boolean
  onArm:     (id: string) => void
  onRelease: (id: string) => void
  onSaved:   (id: string, track: Track) => void
  onDelete:  (id: string) => void
  onPlaybackStart: () => void
  onPlaybackStop:  () => void
  onSeekTo: (positionSec: number) => void
  playCountdown: (bpm: number, timeSig: string) => Promise<void>
}

export const RecordingTrackRow = memo(function RecordingTrackRow({
  id, name, onNameChange,
  versionId, bpm, timeSig, totalBars, countdownEnabled,
  getPlaybackMs, isPlaying,
  isActiveRecording,
  onArm, onRelease, onSaved, onDelete,
  onPlaybackStart, onPlaybackStop, onSeekTo,
  playCountdown,
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

  const streamRef       = useRef<MediaStream | null>(null)
  const recorderRef     = useRef<MediaRecorder | null>(null)
  const chunksRef       = useRef<Blob[]>([])
  const audioBufferRef  = useRef<AudioBuffer | null>(null)
  const startBarRef     = useRef(0)
  const previewSrcRef   = useRef<AudioBufferSourceNode | null>(null)
  const monitorAudioRef = useRef<HTMLAudioElement | null>(null)
  const recordTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const armGenRef       = useRef(0)
  const armInFlightRef  = useRef(false)
  const stateRef        = useRef<RecordState>('idle')
  stateRef.current = state
  const meterSourceRef  = useRef<MediaStreamAudioSourceNode | null>(null)
  const meterAnalyserRef = useRef<AnalyserNode | null>(null)
  const meterSilentRef  = useRef<GainNode | null>(null)
  const meterRafRef     = useRef(0)
  const meterDataRef    = useRef<Float32Array | null>(null)
  const lastMeterRenderRef = useRef(0)

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(meterRafRef.current)
    meterRafRef.current = 0
    try { meterSourceRef.current?.disconnect() } catch { /* ok */ }
    try { meterAnalyserRef.current?.disconnect() } catch { /* ok */ }
    try { meterSilentRef.current?.disconnect() } catch { /* ok */ }
    meterSourceRef.current = null
    meterAnalyserRef.current = null
    meterSilentRef.current = null
    meterDataRef.current = null
    setInputLevel(0)
  }, [])

  const startMeter = useCallback(async (stream: MediaStream) => {
    stopMeter()
    const ctx = await resumeRecordingAudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.3
    const silent = ctx.createGain()
    silent.gain.value = 0
    source.connect(analyser)
    source.connect(silent)
    silent.connect(ctx.destination)
    meterSourceRef.current = source
    meterAnalyserRef.current = analyser
    meterSilentRef.current = silent
    meterDataRef.current = new Float32Array(analyser.fftSize)
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
    const monitor = monitorAudioRef.current
    if (monitor) {
      monitor.pause()
      monitor.srcObject = null
    }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [stopMeter])

  const attachMonitor = useCallback((stream: MediaStream, vol: number) => {
    if (vol <= 0) return
    const el = monitorAudioRef.current
    if (!el) return
    el.srcObject = stream
    el.volume = vol
    el.muted = false
    void el.play().catch(() => {})
  }, [])

  const detachMonitor = useCallback(() => {
    const el = monitorAudioRef.current
    if (!el) return
    el.pause()
    el.muted = true
    el.srcObject = null
  }, [])

  const acquireMic = useCallback(async (deviceId: string, gen: number) => {
    if (streamRef.current) stopStream()
    const audio: MediaTrackConstraints = {
      deviceId: deviceId ? { ideal: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false })
    if (gen !== armGenRef.current) {
      stream.getTracks().forEach(t => t.stop())
      return null
    }
    streamRef.current = stream
    return stream
  }, [stopStream])

  async function handleArm() {
    if (armInFlightRef.current) return
    if (stateRef.current !== 'idle') return
    if (isActiveRecording) return

    armInFlightRef.current = true
    const gen = ++armGenRef.current
    setState('permitting')
    setError('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      if (gen !== armGenRef.current) {
        stream.getTracks().forEach(t => t.stop())
        return
      }

      // Yield — do not touch Web Audio or <audio> in the permission callback tick.
      await new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
      if (gen !== armGenRef.current) {
        stream.getTracks().forEach(t => t.stop())
        return
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
    detachMonitor()
    const gen = armGenRef.current
    try {
      const stream = await acquireMic(deviceId, gen)
      if (stream) {
        if (monitorVol > 0) attachMonitor(stream, monitorVol)
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
    const stream = streamRef.current
    if (!stream) return
    if (vol > 0) attachMonitor(stream, vol)
    else detachMonitor()
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

    const beatsPerBar = parseInt(timeSig.split('/')[0]) || 4
    const barDurMs    = (60000 / bpm) * beatsPerBar

    // Snap to the previous bar boundary and always play count-in.
    // Seek the player NOW so offsetRef is locked to the bar start — when
    // onPlaybackStart fires after the countdown, playback resumes from exactly
    // that bar, not from wherever the user originally paused.
    const snapBar    = Math.floor(getPlaybackMs() / barDurMs)
    const snapPosSec = snapBar * (barDurMs / 1000)
    onSeekTo(snapPosSec)

    setState('countdown')
    await playCountdown(bpm, timeSig)

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
      recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128000 })
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

    // Stop HTML monitor before MediaRecorder uses the same stream.
    detachMonitor()

    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    recorder.onstop = () => { void processBlob(mimeType) }
    recorderRef.current = recorder

    setState('recording')
    recorder.start(250)
    recordTimerRef.current = setInterval(() => {
      setRecordingSec(s => s + 0.25)
    }, 250)

    window.setTimeout(() => onPlaybackStart(), 300)
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
    } catch (e) {
      console.error('[RecordingTrackRow] decode failed:', e)
      setError('Could not decode recording')
    }
  }

  const previewMutedRef = useRef(previewMuted)
  previewMutedRef.current = previewMuted

  useEffect(() => {
    if (stateRef.current !== 'preview' || !audioBufferRef.current) return
    const audioCtx = getSharedAudioContext()

    if (isPlaying && !previewMutedRef.current) {
      const beatsPerBar       = parseInt(timeSig.split('/')[0]) || 4
      const barDurSec         = (60 / bpm) * beatsPerBar
      const recordingStartSec = startBarRef.current * barDurSec
      const buf               = audioBufferRef.current
      const recordingEndSec   = recordingStartSec + buf.duration
      const playNowSec        = getPlaybackMs() / 1000

      previewSrcRef.current?.stop()
      previewSrcRef.current = null

      // Only schedule if playhead hasn't passed the end of the recording
      if (playNowSec < recordingEndSec) {
        const src = audioCtx.createBufferSource()
        src.buffer = buf
        src.connect(getMasterOutput())

        // Derive the AudioContext "song zero" time:
        // ctx.currentTime ≈ acxZero + playNowSec  →  acxZero = ctx.currentTime - playNowSec
        const acxNow  = audioCtx.currentTime
        const acxZero = acxNow - playNowSec

        if (playNowSec < recordingStartSec) {
          // Playhead is before the recording — schedule start at the right AC time
          src.start(acxZero + recordingStartSec, 0)
        } else {
          // Playhead is inside the recording — start immediately from the correct offset
          src.start(acxNow, playNowSec - recordingStartSec)
        }
        previewSrcRef.current = src
      }
    } else {
      previewSrcRef.current?.stop()
      previewSrcRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, state, previewMuted])

  async function handleReRecord() {
    previewSrcRef.current?.stop()
    previewSrcRef.current = null
    audioBufferRef.current = null
    chunksRef.current = []
    setStaticBars([])
    setRecordedDurationSec(0)
    setRecordingSec(0)
    setRecordingBars([])
    setLiveBars(Array(LIVE_MONITOR_BARS).fill(0))
    setState('armed')
    const gen = armGenRef.current
    try {
      const stream = await acquireMic(selectedDevice, gen)
      if (stream) {
        if (monitorVol > 0) attachMonitor(stream, monitorVol)
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
    try {
      const wavBlob  = encodeWAV(decoded, 0)
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
          durationMs: Math.round(recordedDurationSec * 1000),
        }),
      })
      if (!processRes.ok) throw new Error(`Process ${processRes.status}`)
      const { track } = await processRes.json()

      // Seed the waveform cache so the regular TrackRow renders the bars immediately
      // (without waiting for the audio stream to re-download and decode).
      if (staticBars.length > 0) waveformBarsCache.set(track.id, staticBars)
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
  const waveformLeft = totalBars > 0
    ? `${(timelineStartBar / totalBars) * 100}%`
    : '0'
  const waveformWidth = totalBars > 0
    ? `${Math.min(100, Math.max((1 / totalBars) * 100, ((isRecording ? liveRecordedBars : recordedBars) / totalBars) * 100))}%`
    : '100%'
  const oneBarWidthPct = totalBars > 0 ? `${Math.max((1 / totalBars) * 100, 1.5)}%` : '4%'
  const liveMeterWidth = isRecording ? waveformWidth : oneBarWidthPct
  const liveSpectrumBars = isRecording
    ? recordingBars
    : (liveBars.some(v => v > 0.02) ? liveBars : [inputLevel])
  const showRecordedWaveform = (isPreview || isSaving) && staticBars.length > 0
  const showLiveSpectrum = showLiveMeter && isRecording && recordingBars.length > 0
  const showLiveVolumeBar = showLiveMeter && !showLiveSpectrum
  // Match the visual bar density of other tracks (96 bars across the full row).
  // Recording spans recordedBars/totalBars of the row → scale proportionally.
  const previewBarCount = Math.max(4, Math.round(BAR_COUNT * (recordedBars / Math.max(1, totalBars))))
  // Same density for the live waveform — grows as recording progresses.
  const liveBarCount = Math.max(4, Math.round(BAR_COUNT * (liveRecordedBars / Math.max(1, totalBars))))

  const showDeviceSelect = devices.length > 0 && (isArmed || isCounting || isRecording)

  return (
    <div
      data-track-row
      className="flex border-t border-border"
      style={{
        minHeight: 80,
        background: isRecording
          ? 'color-mix(in srgb, var(--ember) 5%, var(--surface))'
          : 'var(--surface)',
      }}
    >
      {/* Hidden element for zero-latency-style monitor — no Web Audio graph */}
      <audio ref={monitorAudioRef} className="hidden" playsInline />

      <div
        className="shrink-0 border-r border-border flex flex-col justify-between py-2 px-3"
        style={{ width: TRACK_LABEL_W }}
      >
        <div className="flex items-center gap-1.5 mb-1 min-w-0">
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

        <div className="flex flex-col gap-1.5 min-w-0">
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
              className="w-full text-[9px] bg-surface border border-border text-foreground px-1 py-0.5 truncate"
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
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setPreviewMuted(m => !m)}
                className="text-[9px] uppercase tracking-widest"
                style={{ color: previewMuted ? 'var(--muted-foreground)' : 'var(--ember)' }}
              >
                {previewMuted ? 'Muted' : 'Mix'}
              </button>
              <button type="button" onClick={() => void handleSave()}
                className="text-[9px] uppercase tracking-widest font-semibold text-ember">
                Save
              </button>
              <button type="button" onClick={handleDiscard}
                className="text-[9px] uppercase tracking-widest text-muted-foreground hover:text-foreground">
                Discard
              </button>
            </div>
          )}

          {isSaving && (
            <span className="text-[9px] uppercase tracking-widest text-ember">
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
                className="flex-1 min-w-0 accent-ember"
              />
            </div>
          )}

          {showControls && (
            <p className="text-[8px] leading-tight text-muted-foreground opacity-60 m-0">
              {isArmed ? 'Mic ready' : isRecording ? 'Recording…' : 'Demo quality · mono'}
            </p>
          )}

          {error && (
            <span className="text-[9px] truncate text-destructive">{error}</span>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 relative overflow-hidden border-l border-border/0" style={{ minHeight: 80 }}>
        <TactGrid totalBars={totalBars} />

        {showLiveVolumeBar && (
          <LiveVolumeBar
            level={inputLevel}
            pulsing={isRecording || isCounting}
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
      </div>

      <style>{`
        @keyframes recPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  )
})
