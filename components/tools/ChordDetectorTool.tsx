'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'motion/react'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const ACCEPTED_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'm4a']
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.map(e => `.${e}`).join(',')
const BEATS_PER_BAR = 4
const EASE = [0.16, 1, 0.3, 1] as const

type Phase = 'idle' | 'selected' | 'processing'

interface DetectedChord {
  timestamp_ms: number
  chord: string
}

interface AnalysisResponse {
  key: string
  duration_seconds: number
  chords: DetectedChord[]
}

interface AnalysisState extends AnalysisResponse {
  filename: string
  bpm: number
  audioUrl: string
}

interface ChordRow {
  startSec: number
  endSec: number
  startBar: number
  endBar: number
  chord: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}:${String(rem).padStart(2, '0')}`
}

/** bar = floor(timestamp_seconds / (60/bpm) / beats_per_bar) + 1, assuming 4/4. */
function barNumber(timestampSec: number, bpm: number): number {
  const beatDurationSec = 60 / bpm
  return Math.floor(timestampSec / beatDurationSec / BEATS_PER_BAR) + 1
}

function extOf(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx === -1 ? '' : filename.slice(idx + 1).toLowerCase()
}

function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return 'This file is too large. Please upload a file under 10 MB.'
  }
  if (!ACCEPTED_EXTENSIONS.includes(extOf(file.name))) {
    return 'Unsupported file type. Please use MP3, WAV, FLAC, OGG, or M4A.'
  }
  return null
}

function buildRows(analysis: AnalysisState): ChordRow[] {
  const { chords, duration_seconds, bpm } = analysis
  return chords.map((c, i) => {
    const startSec = c.timestamp_ms / 1000
    const endSec = i + 1 < chords.length ? chords[i + 1].timestamp_ms / 1000 : duration_seconds
    const startBar = barNumber(startSec, bpm)
    const endBar = barNumber(Math.max(startSec, endSec - 0.001), bpm)
    return { startSec, endSec, startBar, endBar, chord: c.chord }
  })
}

/** Copy target is just the chord names, in order — no timestamps or bars. */
function buildCopyText(rows: ChordRow[]): string {
  return rows.map(r => r.chord).join('\n')
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconUpload() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 16V4m0 0L7 9m5-5l5 5M5 16v2a2 2 0 002 2h10a2 2 0 002-2v-2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function IconPlay({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5-11-6.5z" />
    </svg>
  )
}

function IconPause({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="0.5" />
      <rect x="14" y="5" width="4" height="14" rx="0.5" />
    </svg>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChordDetectorTool() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [bpm, setBpm] = useState('')
  const [dragging, setDragging] = useState(false)
  const [clientError, setClientError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<{ message: string; showSignup?: boolean } | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null)
  const [copied, setCopied] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Play-along
  const audioRef = useRef<HTMLAudioElement>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)

  const rows = useMemo(() => (analysis ? buildRows(analysis) : []), [analysis])

  const activeRowIndex = useMemo(() => {
    if (!rows.length) return -1
    for (let i = rows.length - 1; i >= 0; i--) {
      if (currentTime >= rows[i].startSec) return i
    }
    return -1
  }, [rows, currentTime])

  useEffect(() => {
    if (!playing || activeRowIndex < 0) return
    rowRefs.current[activeRowIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeRowIndex, playing])

  // Revoke the blob URL when it's replaced or the component unmounts — nothing persists beyond the tab.
  useEffect(() => {
    return () => {
      if (analysis?.audioUrl) URL.revokeObjectURL(analysis.audioUrl)
    }
  }, [analysis?.audioUrl])

  function pickFile(f: File) {
    const err = validateFile(f)
    setServerError(null)
    if (err) {
      setClientError(err)
      setFile(null)
      setPhase('idle')
      return
    }
    setClientError(null)
    setFile(f)
    setPhase('selected')
  }

  function resetToUpload() {
    setPhase('idle')
    setFile(null)
    setBpm('')
    setClientError(null)
    setServerError(null)
    setPlaying(false)
    setCurrentTime(0)
    setAudioDuration(0)
    if (analysis?.audioUrl) URL.revokeObjectURL(analysis.audioUrl)
    setAnalysis(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function onSubmit() {
    if (!file) return
    const bpmNum = Number(bpm)
    if (!bpm.trim() || !Number.isFinite(bpmNum) || bpmNum < 40 || bpmNum > 300) {
      setClientError('Please enter the track BPM.')
      return
    }
    setClientError(null)
    setServerError(null)
    setPhase('processing')

    try {
      const fd = new FormData()
      fd.set('file', file)
      fd.set('bpm', String(bpmNum))
      const res = await fetch('/api/tools/chord-detector', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        if (res.status === 429) {
          setServerError({ message: data.error ?? "You've reached the limit of 5 analyses per hour.", showSignup: true })
        } else {
          setServerError({ message: data.error ?? 'Something went wrong during analysis. Please try again or try a different file.' })
        }
        setPhase('selected')
        return
      }

      if (analysis?.audioUrl) URL.revokeObjectURL(analysis.audioUrl)

      setAnalysis({
        key: data.key,
        duration_seconds: data.duration_seconds,
        chords: data.chords ?? [],
        filename: file.name,
        bpm: bpmNum,
        audioUrl: URL.createObjectURL(file),
      })
      setPlaying(false)
      setCurrentTime(0)
      setAudioDuration(0)
      setPhase('idle')
      setFile(null)
      setBpm('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch {
      setServerError({ message: 'Something went wrong during analysis. Please try again or try a different file.' })
      setPhase('selected')
    }
  }

  async function copyList() {
    if (!analysis) return
    try {
      await navigator.clipboard.writeText(buildCopyText(rows))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API unavailable — silently ignore, button just won't confirm.
    }
  }

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }

  function seekTo(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current
    if (!audio || !audioDuration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    audio.currentTime = ratio * audioDuration
    setCurrentTime(audio.currentTime)
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    if (phase !== 'idle') return
    const f = e.dataTransfer.files?.[0]
    if (f) pickFile(f)
  }

  const borderMuted = 'border-[color-mix(in_oklab,var(--border)_80%,transparent)]'
  const totalDuration = audioDuration || analysis?.duration_seconds || 0
  const progressPct = totalDuration > 0 ? Math.min(100, (currentTime / totalDuration) * 100) : 0

  return (
    <div>
      {/* Server-level error banner (submit failures, rate limit) */}
      <AnimatePresence>
        {serverError && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className={`mb-4 border ${borderMuted} bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] p-3.5`}>
              <p className="font-mono-tb text-[11px] leading-relaxed text-[color:var(--destructive)]">{serverError.message}</p>
              {serverError.showSignup && (
                <Link href="/" className="font-mono-tb mt-1.5 inline-block text-[11px] uppercase tracking-[0.1em] text-lime underline-offset-4 hover:underline">
                  Sign up for unlimited access →
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload area / processing state */}
      <AnimatePresence mode="wait">
        {phase === 'processing' ? (
          <motion.div
            key="processing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className={`border ${borderMuted} p-10 text-center`}
          >
            <div className="mx-auto flex h-9 w-24 items-end justify-center gap-1.5" aria-hidden="true">
              {[0, 1, 2, 3, 4].map(i => (
                <span
                  key={i}
                  className="animate-bars-pulse w-1.5 rounded-sm bg-lime"
                  style={{ animationDelay: `${i * 0.12}s` }}
                />
              ))}
            </div>
            <motion.p
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
              className="font-mono-tb mt-4 text-[12px] text-foreground"
            >
              Analyzing harmonics...
            </motion.p>
            <p className="font-mono-tb mt-1 text-[10px] text-muted-foreground">Usually takes 10–30 seconds</p>
          </motion.div>
        ) : (
          <motion.div
            key="dropzone"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, scale: dragging ? 1.012 : 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            onClick={() => phase === 'idle' && fileInputRef.current?.click()}
            onDragOver={e => { if (phase === 'idle') { e.preventDefault(); setDragging(true) } }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`border border-dashed p-6 transition-colors sm:p-8 ${
              phase === 'idle' ? 'cursor-pointer text-center' : 'text-left'
            } ${dragging ? 'border-lime bg-lime-soft' : `${borderMuted} ${phase === 'idle' ? 'hover:border-lime' : ''}`}`}
          >
            <AnimatePresence mode="wait">
              {phase === 'idle' ? (
                <motion.div
                  key="idle-content"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="flex justify-center text-lime">
                    <IconUpload />
                  </div>
                  <p className="font-mono-tb mt-3 text-[12px] text-foreground">
                    Drag and drop an audio file, or <span className="text-lime underline underline-offset-2">browse</span>
                  </p>
                  <p className="font-mono-tb mt-2 text-[10px] text-muted-foreground">
                    Max 10 MB · MP3, WAV, FLAC, OGG, M4A
                  </p>
                </motion.div>
              ) : (
                file && (
                  <motion.div
                    key="selected-content"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25, ease: EASE }}
                    onClick={e => e.stopPropagation()}
                  >
                    <p className="font-mono-tb text-[12px] text-foreground">
                      {file.name} <span className="text-muted-foreground">· {formatFileSize(file.size)}</span>
                    </p>

                    <label className="mt-5 block">
                      <span className="font-mono-tb block text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        Track BPM
                      </span>
                      <input
                        type="number"
                        min={40}
                        max={300}
                        required
                        value={bpm}
                        onChange={e => setBpm(e.target.value)}
                        placeholder="e.g. 120"
                        className={`font-mono-tb mt-1.5 w-full max-w-[160px] border ${borderMuted} bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:border-lime`}
                      />
                    </label>
                    <p className="font-mono-tb mt-1.5 max-w-[420px] text-[10px] leading-relaxed text-muted-foreground">
                      Enter the tempo of your track. Used to align chord changes to bar positions.
                    </p>

                    {clientError && (
                      <p className="font-mono-tb mt-2 text-[11px] text-[color:var(--destructive)]">{clientError}</p>
                    )}

                    <button
                      type="button"
                      onClick={onSubmit}
                      className="tb-btn-accent mt-4 inline-flex items-center bg-lime px-5 py-2.5 text-[11px] uppercase"
                    >
                      Detect Chords
                    </button>
                  </motion.div>
                )
              )}
            </AnimatePresence>

            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ATTR}
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) pickFile(f)
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {clientError && phase === 'idle' && (
        <p className="font-mono-tb mt-2 text-[11px] text-[color:var(--destructive)]">{clientError}</p>
      )}

      {/* Results */}
      <AnimatePresence>
        {analysis && (
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="mt-10"
          >
            <audio
              ref={audioRef}
              src={analysis.audioUrl}
              preload="metadata"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
              onLoadedMetadata={e => setAudioDuration(e.currentTarget.duration)}
              className="hidden"
            />

            <div className={`mb-4 flex items-start justify-between gap-4 border-b ${borderMuted} pb-3`}>
              <div className="min-w-0">
                <p className="font-display-tb truncate text-sm font-bold">{analysis.filename}</p>
                <p className="font-mono-tb mt-1 text-[10px] text-muted-foreground">
                  {formatTime(analysis.duration_seconds)} · {analysis.bpm} BPM · {analysis.key}
                </p>
              </div>
              <button
                type="button"
                onClick={resetToUpload}
                className="font-mono-tb shrink-0 text-[10px] uppercase tracking-[0.1em] text-lime underline-offset-4 hover:underline"
              >
                Analyze another file
              </button>
            </div>

            {/* Play along */}
            <div className={`mb-4 flex items-center gap-3 border ${borderMuted} p-3`}>
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
                className="grid size-9 shrink-0 place-items-center rounded-full bg-lime text-primary-foreground transition active:scale-95"
              >
                {playing ? <IconPause /> : <IconPlay />}
              </button>
              <div
                onClick={seekTo}
                className={`h-1.5 flex-1 cursor-pointer bg-[color-mix(in_oklab,var(--border)_70%,transparent)]`}
              >
                <div className="h-full bg-lime" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="font-mono-tb w-[72px] shrink-0 text-right text-[10px] text-muted-foreground">
                {formatTime(currentTime)} / {formatTime(totalDuration)}
              </span>
            </div>

            {rows.length === 0 ? (
              <p className="font-mono-tb text-[11px] text-muted-foreground">No chords detected — try a clip with more harmonic content.</p>
            ) : (
              <div className={`max-h-[420px] overflow-y-auto border ${borderMuted}`}>
                {rows.map((row, i) => {
                  const active = i === activeRowIndex
                  return (
                    <motion.div
                      key={i}
                      ref={el => { rowRefs.current[i] = el }}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.6), ease: EASE }}
                      className={`flex items-center gap-4 border-l-2 px-3 py-2 transition-colors ${
                        active
                          ? 'border-lime bg-[color-mix(in_oklab,var(--lime)_16%,transparent)]'
                          : `border-transparent ${i % 2 === 1 ? 'bg-[color-mix(in_oklab,var(--card)_25%,transparent)]' : ''}`
                      } ${i > 0 ? `border-t ${borderMuted}` : ''}`}
                    >
                      <span className="font-mono-tb w-[92px] shrink-0 text-[11px] text-muted-foreground">
                        {formatTime(row.startSec)} – {formatTime(row.endSec)}
                      </span>
                      <span className="font-mono-tb w-[80px] shrink-0 text-[11px] text-muted-foreground">
                        {row.startBar === row.endBar ? `Bar ${row.startBar}` : `Bars ${row.startBar}–${row.endBar}`}
                      </span>
                      <span className={`font-display-tb text-[13px] font-bold ${active ? 'text-lime' : ''}`}>
                        {row.chord}
                      </span>
                    </motion.div>
                  )
                })}
              </div>
            )}

            {rows.length > 0 && (
              <button
                type="button"
                onClick={copyList}
                className={`mt-3 inline-flex items-center border ${borderMuted} px-3 py-1.5 font-mono-tb text-[10px] uppercase tracking-[0.14em] text-foreground transition-colors hover:border-lime hover:text-lime`}
              >
                {copied ? 'Copied' : 'Copy chord list'}
              </button>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  )
}
