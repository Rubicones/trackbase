'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { getSharedAudioContext } from '@/lib/audioContext'
import type { Project } from '@/lib/types'

// ─── WAV encoder ──────────────────────────────────────────────────────────────
// Writes a standard 16-bit PCM WAV file from an AudioBuffer.
// latencyOffsetSeconds: trim this many seconds from the start to compensate
// for round-trip latency (baseLatency + outputLatency).

function encodeWAV(audioBuffer: AudioBuffer, latencyOffsetSeconds: number): Blob {
  const sampleRate = audioBuffer.sampleRate
  const numChannels = audioBuffer.numberOfChannels
  const skipSamples = Math.max(0, Math.floor(latencyOffsetSeconds * sampleRate))
  const length = Math.max(0, audioBuffer.length - skipSamples)

  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = length * blockAlign
  const totalSize = 44 + dataSize

  const ab = new ArrayBuffer(totalSize)
  const view = new DataView(ab)

  function writeStr(offset: number, s: string) {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  // RIFF
  writeStr(0, 'RIFF')
  view.setUint32(4, totalSize - 8, true)
  writeStr(8, 'WAVE')
  // fmt
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)           // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  // data
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  let off = 44
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i + skipSamples]))
      view.setInt16(off, Math.round(s * 32767), true)
      off += 2
    }
  }

  return new Blob([ab], { type: 'audio/wav' })
}

// ─── Upload helper ─────────────────────────────────────────────────────────────

async function uploadRecordedTrack(
  wavBlob: Blob,
  versionId: string,
  filename: string,
  startBar: number,
  onStatus: (s: string) => void,
): Promise<void> {
  onStatus('Preparing upload…')
  const presignRes = await fetch(`/api/versions/${versionId}/tracks/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, fileSize: wavBlob.size, contentType: 'audio/wav' }),
  })
  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({}))
    throw new Error(err.error ?? 'Failed to get upload URL')
  }
  const { presignedUrl, tempKey } = await presignRes.json()

  onStatus('Uploading…')
  const uploadRes = await fetch(presignedUrl, {
    method: 'PUT',
    body: wavBlob,
    headers: { 'Content-Type': 'audio/wav' },
  })
  if (!uploadRes.ok) throw new Error('Storage upload failed')

  onStatus('Processing…')
  const processRes = await fetch(`/api/versions/${versionId}/tracks/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tempKey,
      originalFilename: filename,
      fileSize: wavBlob.size,
      mimetype: 'audio/wav',
      startBar,
    }),
  })
  if (!processRes.ok) {
    const err = await processRes.json().catch(() => ({}))
    throw new Error(err.error ?? 'Processing failed')
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtSecs(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

function getBpmNumerator(project: Project): { bpm: number; numerator: number } {
  const bpm = project.bpm ?? 120
  const numerator = parseInt(project.time_signature?.split('/')[0] ?? '4', 10) || 4
  return { bpm, numerator }
}

const BUILTIN_MIC_KEYWORDS = ['built-in', 'default', 'internal', 'macbook', 'facetime']

function isBuiltinMic(label: string): boolean {
  const l = label.toLowerCase()
  return BUILTIN_MIC_KEYWORDS.some(k => l.includes(k))
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface RecordingPanelProps {
  versionId: string
  project: Project
  currentPlaybackTime: number  // player.currentTime in seconds
  isPlaying: boolean
  onPlay: () => void
  onPause: () => void
  onTrackAdded: () => void
  onClose: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RecordingPanel({
  versionId, project, currentPlaybackTime, isPlaying,
  onPlay, onPause, onTrackAdded, onClose,
}: RecordingPanelProps) {

  // ── Permission / devices ───────────────────────────────────────────────────
  const [permState, setPermState] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() =>
    typeof localStorage !== 'undefined' ? localStorage.getItem('rec_deviceId') ?? '' : ''
  )
  const [actualChannelCount, setActualChannelCount] = useState<number | null>(null)
  const [latencyMs, setLatencyMs] = useState<number | null>(null)

  // ── Stream / nodes ─────────────────────────────────────────────────────────
  const streamRef = useRef<MediaStream | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const monitorGainRef = useRef<GainNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const levelRafRef = useRef<number>(0)

  // ── Monitoring ─────────────────────────────────────────────────────────────
  const [monitorVolume, setMonitorVolume] = useState(0)
  const [inputLevel, setInputLevel] = useState(0) // 0–1 peak
  const [isClipping, setIsClipping] = useState(false)

  // ── Recording state ────────────────────────────────────────────────────────
  type Status = 'idle' | 'countdown' | 'recording' | 'processing' | 'done' | 'error'
  const [status, setStatus] = useState<Status>('idle')
  const [countdownBeat, setCountdownBeat] = useState(0)     // 1-indexed beat shown
  const [totalBeats, setTotalBeats] = useState(4)
  const [recordingElapsed, setRecordingElapsed] = useState(0)
  const [processStatus, setProcessStatus] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  // ── Options ────────────────────────────────────────────────────────────────
  const [metronomeOn, setMetronomeOn] = useState(true)
  const [recordWithPlayback, setRecordWithPlayback] = useState(false)

  // ── Internals ──────────────────────────────────────────────────────────────
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingStartAcxTimeRef = useRef(0)   // AudioContext time when recording began
  const recordingStartBarRef = useRef(0)        // bar index when recording began
  const metronomeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const metronomeStateRef = useRef<{ nextBeatTime: number; beat: number; running: boolean } | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Request mic permission on mount ───────────────────────────────────────
  useEffect(() => {
    requestPermission()
    return () => {
      teardownStream()
      stopMetronome()
      clearInterval(elapsedTimerRef.current!)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function requestPermission() {
    setPermState('requesting')
    try {
      // Minimal stream just to trigger the permission prompt
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      probe.getTracks().forEach(t => t.stop())
      setPermState('granted')
      await enumerateDevices()
    } catch {
      setPermState('denied')
    }
  }

  async function enumerateDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      const inputs = all.filter(d => d.kind === 'audioinput')
      setDevices(inputs)
      // If no device stored yet (or stored one is gone), default to first
      const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('rec_deviceId') ?? '' : ''
      const valid = inputs.find(d => d.deviceId === stored)
      const chosen = valid?.deviceId ?? inputs[0]?.deviceId ?? ''
      setSelectedDeviceId(chosen)
    } catch { /* silent */ }
  }

  // ── Open stream whenever selectedDeviceId changes ─────────────────────────
  useEffect(() => {
    if (permState !== 'granted' || !selectedDeviceId) return
    openStream(selectedDeviceId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permState, selectedDeviceId])

  async function openStream(deviceId: string) {
    teardownStream()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
          sampleRate: 48000,
        },
        video: false,
      })
      streamRef.current = stream

      // Check actual settings
      const settings = stream.getAudioTracks()[0]?.getSettings()
      setActualChannelCount(settings?.channelCount ?? null)

      // Save device choice
      if (typeof localStorage !== 'undefined') localStorage.setItem('rec_deviceId', deviceId)

      // Wire up AudioContext nodes
      const actx = getSharedAudioContext()
      if (actx.state === 'suspended') await actx.resume()

      // Latency display
      const totalLatency = (actx.baseLatency ?? 0) + (actx.outputLatency ?? 0)
      setLatencyMs(Math.round(totalLatency * 1000))

      // Default monitor volume: 0 for built-in mics (feedback prevention), 0.8 for interfaces
      const label = stream.getAudioTracks()[0]?.label ?? ''
      const defaultVol = isBuiltinMic(label) ? 0 : 0.8
      setMonitorVolume(defaultVol)

      const source = actx.createMediaStreamSource(stream)
      sourceRef.current = source

      // Branch 1: monitoring (default 0 to avoid feedback)
      const monGain = actx.createGain()
      monGain.gain.value = defaultVol
      source.connect(monGain)
      monGain.connect(actx.destination)
      monitorGainRef.current = monGain

      // Branch 2: level analyser
      const analyser = actx.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      analyserRef.current = analyser

      startLevelMeter(analyser)
    } catch (err) {
      console.error('[RecordingPanel] stream error:', err)
      setErrorMsg(`Could not open device: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  function teardownStream() {
    cancelAnimationFrame(levelRafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    sourceRef.current?.disconnect()
    sourceRef.current = null
    monitorGainRef.current?.disconnect()
    monitorGainRef.current = null
    analyserRef.current?.disconnect()
    analyserRef.current = null
  }

  // ── Level metering ─────────────────────────────────────────────────────────

  function startLevelMeter(analyser: AnalyserNode) {
    cancelAnimationFrame(levelRafRef.current)
    const buf = new Float32Array(analyser.fftSize)
    function tick() {
      analyser.getFloatTimeDomainData(buf)
      let peak = 0
      for (let i = 0; i < buf.length; i++) {
        const abs = Math.abs(buf[i])
        if (abs > peak) peak = abs
      }
      setInputLevel(peak)
      setIsClipping(peak >= 1.0)
      levelRafRef.current = requestAnimationFrame(tick)
    }
    levelRafRef.current = requestAnimationFrame(tick)
  }

  // ── Monitor volume ─────────────────────────────────────────────────────────

  function handleMonitorVolume(v: number) {
    setMonitorVolume(v)
    if (monitorGainRef.current) monitorGainRef.current.gain.value = v
  }

  // ── Metronome (look-ahead scheduler) ──────────────────────────────────────

  function scheduleSingleBeat(beatTime: number, isDownbeat: boolean) {
    const actx = getSharedAudioContext()
    const osc = actx.createOscillator()
    const gain = actx.createGain()
    osc.frequency.value = isDownbeat ? 1000 : 700
    gain.gain.setValueAtTime(0.5, beatTime)
    gain.gain.exponentialRampToValueAtTime(0.001, beatTime + 0.05)
    osc.connect(gain)
    gain.connect(actx.destination)
    osc.start(beatTime)
    osc.stop(beatTime + 0.08)
  }

  function startMetronome(startAt?: number) {
    stopMetronome()
    const actx = getSharedAudioContext()
    const { bpm, numerator } = getBpmNumerator(project)
    const spb = 60 / bpm
    const state = {
      nextBeatTime: startAt ?? actx.currentTime + 0.05,
      beat: 0,
      running: true,
    }
    metronomeStateRef.current = state

    function schedule() {
      if (!state.running) return
      const actx = getSharedAudioContext()
      while (state.nextBeatTime < actx.currentTime + 0.1) {
        scheduleSingleBeat(state.nextBeatTime, state.beat === 0)
        state.nextBeatTime += spb
        state.beat = (state.beat + 1) % numerator
      }
      metronomeTimerRef.current = setTimeout(schedule, 25)
    }
    schedule()
  }

  function stopMetronome() {
    const s = metronomeStateRef.current
    if (s) s.running = false
    if (metronomeTimerRef.current !== null) clearTimeout(metronomeTimerRef.current)
    metronomeTimerRef.current = null
    metronomeStateRef.current = null
  }

  useEffect(() => {
    if (metronomeOn && permState === 'granted') {
      startMetronome()
    } else {
      stopMetronome()
    }
    return stopMetronome
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metronomeOn, permState])

  // ── Record flow ────────────────────────────────────────────────────────────

  function handleRecordClick() {
    if (status === 'recording') {
      stopRecording()
      return
    }
    if (status !== 'idle' && status !== 'done' && status !== 'error') return
    if (!streamRef.current) return

    // iOS Safari: resume AudioContext synchronously in click handler
    const actx = getSharedAudioContext()
    if (actx.state === 'suspended') actx.resume()

    beginCountdown()
  }

  function beginCountdown() {
    const actx = getSharedAudioContext()
    const { bpm, numerator } = getBpmNumerator(project)
    const spb = 60 / bpm
    const countdownStart = actx.currentTime + 0.15

    setTotalBeats(numerator)
    setCountdownBeat(0)
    setStatus('countdown')
    stopMetronome()  // stop free-running metronome; we'll schedule manually

    // Schedule all countdown beats
    for (let i = 0; i < numerator; i++) {
      const beatTime = countdownStart + i * spb
      scheduleSingleBeat(beatTime, i === 0)

      // Visual beat indicator (setTimeout is only used for visuals, not timing)
      const delay = Math.max(0, (beatTime - actx.currentTime) * 1000)
      setTimeout(() => setCountdownBeat(i + 1), delay)
    }

    // After countdown, start recording
    const recordAt = countdownStart + numerator * spb
    const delayMs = Math.max(0, (recordAt - actx.currentTime) * 1000)

    // Store the start bar before the timeout fires
    const { numerator: num } = getBpmNumerator(project)
    const secondsPerBar = spb * num
    recordingStartBarRef.current = secondsPerBar > 0
      ? Math.floor(currentPlaybackTime / secondsPerBar)
      : 0

    setTimeout(() => {
      beginRecording(recordAt)
    }, delayMs)
  }

  function beginRecording(recordAtAcxTime: number) {
    const stream = streamRef.current
    if (!stream) return

    const actx = getSharedAudioContext()
    recordingStartAcxTimeRef.current = actx.currentTime
    chunksRef.current = []

    // Choose MIME type — iOS Safari doesn't support webm/opus
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : 'audio/webm'

    // Pick highest available bitrate
    const bitsPerSecond = MediaRecorder.isTypeSupported(mimeType + ';bitrate=262144')
      ? 262144  // 256kbps
      : 131072  // 128kbps fallback

    let mr: MediaRecorder
    try {
      mr = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: bitsPerSecond })
    } catch {
      mr = new MediaRecorder(stream)
    }

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    mr.onstop = () => finaliseRecording()

    mediaRecorderRef.current = mr

    // Start the metronome continuing through the recording if enabled
    if (metronomeOn) {
      // Resume metronome from next beat after countdown end
      const { bpm, numerator } = getBpmNumerator(project)
      const spb = 60 / bpm
      // nextBeat starts right at the first beat of actual recording
      startMetronome(recordAtAcxTime)
    }

    mr.start(100)  // 100ms chunks
    setStatus('recording')
    setRecordingElapsed(0)
    setCountdownBeat(0)

    // Elapsed timer
    const startMs = Date.now()
    elapsedTimerRef.current = setInterval(() => {
      setRecordingElapsed(Math.floor((Date.now() - startMs) / 1000))
    }, 500)

    // Start playback if requested
    if (recordWithPlayback && !isPlaying) onPlay()
  }

  function stopRecording() {
    clearInterval(elapsedTimerRef.current!)
    elapsedTimerRef.current = null
    mediaRecorderRef.current?.stop()
    stopMetronome()
    if (isPlaying) onPause()
    setStatus('processing')
    setProcessStatus('Encoding…')
  }

  async function finaliseRecording() {
    const actx = getSharedAudioContext()
    const latencyOffset = (actx.baseLatency ?? 0) + (actx.outputLatency ?? 0)

    // Assemble blob from chunks
    const blob = new Blob(chunksRef.current, { type: mediaRecorderRef.current?.mimeType ?? 'audio/webm' })
    chunksRef.current = []

    try {
      // Decode to verify and apply latency compensation
      const ab = await blob.arrayBuffer()
      const decoded = await actx.decodeAudioData(ab)

      setProcessStatus('Encoding WAV…')
      const wavBlob = encodeWAV(decoded, latencyOffset)

      const filename = `recording-${Date.now()}.wav`
      await uploadRecordedTrack(wavBlob, versionId, filename, recordingStartBarRef.current, setProcessStatus)

      setStatus('done')
      setProcessStatus('')
      onTrackAdded()
    } catch (err) {
      console.error('[RecordingPanel] finalise error:', err)
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStatus('error')
      setProcessStatus('')
    }
  }

  // ── Device change ──────────────────────────────────────────────────────────

  function handleDeviceChange(deviceId: string) {
    setSelectedDeviceId(deviceId)
    // If recording in progress, don't switch mid-recording
    if (status === 'recording' || status === 'countdown') return
    // Re-open stream handled by useEffect on selectedDeviceId change
  }

  // ── Derived display values ─────────────────────────────────────────────────

  const { numerator } = getBpmNumerator(project)
  const isRecording = status === 'recording'
  const isCountdown = status === 'countdown'
  const isProcessing = status === 'processing'
  const canRecord = permState === 'granted' && !!streamRef.current && status !== 'processing'

  // Level meter display: smooth bar width 0–100%
  const levelPct = Math.min(100, inputLevel * 120)  // boost a bit for visual clarity

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[300] flex flex-col"
      style={{
        background: 'var(--bg-card)',
        borderTop: '0.5px solid var(--border-light)',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.18)',
        maxHeight: '320px',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: '0.5px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          {/* Record dot icon */}
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full" style={{ background: isRecording ? '#ef4444' : 'rgba(239,68,68,0.15)' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: isRecording ? '#fff' : '#ef4444' }} />
          </span>
          <span className="text-[13px] font-medium" style={{ color: 'var(--text-sec)' }}>Record Track</span>
          {latencyMs !== null && (
            <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-surface)', color: 'var(--text-dim)' }}>
              ~{latencyMs}ms latency
            </span>
          )}
          {actualChannelCount !== null && (
            <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
              {actualChannelCount === 1 ? 'mono' : 'stereo'}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-[18px] leading-none" style={{ color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Permission states */}
        {permState === 'requesting' && (
          <div className="px-5 py-6 text-center text-[12px]" style={{ color: 'var(--text-dim)' }}>
            <svg className="animate-spin mx-auto mb-2" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
              <path d="M8 2A6 6 0 0 1 14 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            Requesting microphone access…
          </div>
        )}

        {permState === 'denied' && (
          <div className="px-5 py-6 text-center">
            <p className="text-[12px] mb-2" style={{ color: 'var(--text-soft)' }}>Microphone access was denied.</p>
            <p className="text-[11px]" style={{ color: 'var(--text-dim)' }}>
              Enable mic access in your browser settings, then reload.
            </p>
          </div>
        )}

        {permState === 'granted' && (
          <div className="px-5 py-3 flex flex-col gap-3">

            {/* Device + level row */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* Device selector */}
              <select
                value={selectedDeviceId}
                onChange={e => handleDeviceChange(e.target.value)}
                disabled={isRecording || isCountdown}
                className="flex-1 min-w-[160px] text-[12px] rounded-lg px-2.5 py-1.5 outline-none"
                style={{
                  background: 'var(--bg-surface)',
                  border: '0.5px solid var(--border)',
                  color: 'var(--text-soft)',
                  opacity: (isRecording || isCountdown) ? 0.5 : 1,
                }}
              >
                {devices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Microphone (${d.deviceId.slice(0, 6)}…)`}
                  </option>
                ))}
              </select>

              {/* Level meter */}
              <div className="flex items-center gap-2 flex-1 min-w-[120px]">
                <div
                  className="flex-1 h-2 rounded-full overflow-hidden relative"
                  style={{ background: 'var(--border)', minWidth: 80 }}
                >
                  <div
                    className="absolute left-0 top-0 h-full rounded-full transition-[width] duration-[50ms]"
                    style={{
                      width: `${levelPct}%`,
                      background: isClipping
                        ? '#ef4444'
                        : levelPct > 80
                          ? '#f59e0b'
                          : 'var(--accent)',
                    }}
                  />
                </div>
                {isClipping && (
                  <span className="text-[10px] font-semibold shrink-0" style={{ color: '#ef4444' }}>CLIP</span>
                )}
              </div>
            </div>

            {/* Monitor volume */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] shrink-0" style={{ color: 'var(--text-dim)' }}>Monitor</span>
              <input
                type="range" min={0} max={1} step={0.01}
                value={monitorVolume}
                onChange={e => handleMonitorVolume(Number(e.target.value))}
                className="flex-1"
                style={{ accentColor: 'var(--accent)' }}
              />
              <span className="text-[11px] tabular-nums shrink-0 w-8" style={{ color: 'var(--text-dim)' }}>
                {Math.round(monitorVolume * 100)}%
              </span>
            </div>

            {/* Options row */}
            <div className="flex items-center gap-3 flex-wrap">
              <Toggle
                on={metronomeOn}
                onToggle={() => setMetronomeOn(v => !v)}
                label="Metronome"
                icon={
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                    <path d="M6 1v10M3 9L6 1l3 8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                }
              />
              <Toggle
                on={recordWithPlayback}
                onToggle={() => setRecordWithPlayback(v => !v)}
                label="Play with recording"
                icon={
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M3 2l7 4-7 4V2z" />
                  </svg>
                }
              />
            </div>

            {/* Status / countdown / record button row */}
            <div className="flex items-center gap-3 pb-1">

              {/* Record / Stop button */}
              <button
                onClick={handleRecordClick}
                disabled={!canRecord}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: isRecording ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.10)',
                  border: isRecording ? '0.5px solid #ef4444' : '0.5px solid rgba(239,68,68,0.3)',
                  color: '#ef4444',
                }}
              >
                {isRecording ? (
                  <>
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor">
                      <rect x="1" y="1" width="9" height="9" rx="1" />
                    </svg>
                    Stop {fmtSecs(recordingElapsed)}
                  </>
                ) : (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full bg-current" />
                    {isCountdown ? 'Starting…' : 'Record'}
                  </>
                )}
              </button>

              {/* Countdown beats */}
              {isCountdown && (
                <div className="flex items-center gap-1.5">
                  {Array.from({ length: totalBeats }, (_, i) => (
                    <span
                      key={i}
                      className="w-3 h-3 rounded-full transition-all duration-75"
                      style={{
                        background: i < countdownBeat
                          ? '#ef4444'
                          : i === countdownBeat
                            ? 'rgba(239,68,68,0.5)'
                            : 'var(--border)',
                        transform: i + 1 === countdownBeat ? 'scale(1.3)' : 'scale(1)',
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Processing status */}
              {isProcessing && (
                <div className="flex items-center gap-2">
                  <svg className="animate-spin" width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.3" />
                    <path d="M6.5 2A4.5 4.5 0 0 1 11 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>{processStatus}</span>
                </div>
              )}

              {/* Done */}
              {status === 'done' && (
                <span className="text-[12px]" style={{ color: 'var(--green)' }}>✓ Track added</span>
              )}

              {/* Error */}
              {status === 'error' && (
                <span className="text-[12px]" style={{ color: '#ef4444' }} title={errorMsg}>
                  ✕ {errorMsg.length > 60 ? errorMsg.slice(0, 57) + '…' : errorMsg}
                </span>
              )}

              {/* Recording indicator */}
              {isRecording && (
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    REC
                  </span>
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  )
}

// ─── Toggle pill ──────────────────────────────────────────────────────────────

function Toggle({ on, onToggle, label, icon }: {
  on: boolean
  onToggle: () => void
  label: string
  icon?: React.ReactNode
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] transition-all duration-150"
      style={{
        background: on ? 'rgba(99,102,241,0.12)' : 'var(--bg-surface)',
        border: on ? '0.5px solid rgba(99,102,241,0.35)' : '0.5px solid var(--border)',
        color: on ? 'var(--accent)' : 'var(--text-dim)',
      }}
    >
      {icon}
      {label}
    </button>
  )
}
