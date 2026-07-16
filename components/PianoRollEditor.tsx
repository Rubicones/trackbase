'use client'

import {
  useEffect, useRef, useState, useCallback, useLayoutEffect,
  type ButtonHTMLAttributes,
} from 'react'
import { trackEvent } from '@/lib/analytics'
import type { MidiNote, MidiTrackData, Track } from '@/lib/types'
import {
  serializeMidi, gmInstrumentName, gmProgramLabel, GM_PROGRAM_GROUPS,
  sixteenthDuration, sixteenthsPerBar,
} from '@/lib/midi'
// ─── Soundfont loader ─────────────────────────────────────────────────────────

let sharedAudioContext: AudioContext | null = null
function getAudioContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new AudioContext()
  }
  return sharedAudioContext
}

import type Soundfont from 'soundfont-player'
type Player = Awaited<ReturnType<typeof Soundfont.instrument>>

const loadedFonts: Record<string, Player> = {}

async function loadInstrument(programNumber: number): Promise<Player> {
  const name = gmInstrumentName(programNumber)
  if (loadedFonts[name]) return loadedFonts[name]
  const SF = (await import('soundfont-player')).default
  const actx = getAudioContext()
  const player = await SF.instrument(actx, name, { soundfont: 'MusyngKite' })
  loadedFonts[name] = player
  return player
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NOTE_HEIGHT = 30
const MIN_PITCH = 21  // A0
const MAX_PITCH = 108 // C8
const PITCH_RANGE = MAX_PITCH - MIN_PITCH + 1  // 88
const BASE_SIXTEENTH_W = 12
const ZOOM_STEP = 0.25
const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
const BAR_RULER_H = 20

const SNAP_DIVISIONS: Record<string, number> = {
  '1/4': 4,
  '1/8': 8,
  '1/16': 16,
  '1/32': 32,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function snapSixthFloor(rawSixteenth: number, snapDiv: number): number {
  const unit = 16 / snapDiv
  return Math.max(0, Math.floor(rawSixteenth / unit) * unit)
}

function snapDur(dur: number, snapDiv: number): number {
  const unit = 16 / snapDiv
  return Math.max(unit, Math.round(dur / unit) * unit)
}

function noteRect(note: MidiNote, sixteenthW: number) {
  const x = note.startSixteenth * sixteenthW
  const y = (MAX_PITCH - note.pitch) * NOTE_HEIGHT
  const w = Math.max(2, note.durationSixteenths * sixteenthW - 1)
  const h = NOTE_HEIGHT - 1
  return { x, y, w, h }
}

function notesFromSnapshot(snap: MidiNote[]): MidiNote[] {
  return snap.map(n => ({ ...n }))
}

// sha256 helper for save flow
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer)
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const BLACK_SEMITONES_SET = new Set([1, 3, 6, 8, 10])

// ─── UI kit controls ──────────────────────────────────────────────────────────

const midiBtnShared =
  'text-[10px] uppercase tracking-widest transition disabled:opacity-40 disabled:pointer-events-none inline-flex items-center justify-center gap-1.5 border cursor-pointer'

function MidiBtn({
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`${midiBtnShared} border-border bg-surface text-foreground hover:border-lime hover:text-lime px-3 py-1.5 ${className}`}
      {...props}
    />
  )
}

function MidiBtnPrimary({
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`${midiBtnShared} bg-lime text-primary-foreground border-lime px-3 py-1.5 font-bold disabled:opacity-50 ${className}`}
      {...props}
    />
  )
}

function MidiIconBtn({
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`${midiBtnShared} size-7 border-border bg-surface text-foreground hover:border-lime hover:text-lime text-base font-semibold leading-none disabled:opacity-35 ${className}`}
      {...props}
    />
  )
}

function PianoKeyColumn({
  isDark,
  onPreviewPitch,
}: {
  isDark: boolean
  onPreviewPitch: (pitch: number) => void
}) {
  const rowBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'

  return (
    <div style={{ width: NOTE_HEIGHT, flexShrink: 0 }}>
      {Array.from({ length: PITCH_RANGE }, (_, rowIndex) => {
        const pitch = MAX_PITCH - rowIndex
        const isBlack = BLACK_SEMITONES_SET.has(pitch % 12)
        return (
          <button
            key={pitch}
            type="button"
            onClick={() => onPreviewPitch(pitch)}
            aria-label={`Preview ${pitch}`}
            style={{
              display: 'block',
              width: NOTE_HEIGHT,
              height: NOTE_HEIGHT,
              padding: 0,
              margin: 0,
              boxSizing: 'border-box',
              border: 'none',
              borderBottom: `0.5px solid ${rowBorder}`,
              borderRight: `0.5px solid ${rowBorder}`,
              background: isBlack ? '#000000' : '#ffffff',
              outline: isBlack
                ? 'none'
                : `1px solid ${isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.2)'}`,
              outlineOffset: -1,
              cursor: 'pointer',
            }}
          />
        )
      })}
    </div>
  )
}

// ─── Main PianoRollEditor ─────────────────────────────────────────────────────

interface Props {
  track: Track
  projectId: string
  versionId: string
  bpm?: number
  timeSignatureNumerator?: number
  timeSignatureDenominator?: number
  onClose: () => void
  onSaved: (updatedTrack: Partial<Track>) => void | Promise<void>
  isRenderingMidi?: boolean
  playing?: boolean
  currentTimeSec?: number
  audioContext?: AudioContext | null
  onPlayRequest?: () => void
  onPauseRequest?: () => void
  onSeek?: (t: number) => void
  /** Bar offset in the project timeline (0 = starts at project bar 1) */
  midiStartBar?: number
}

export default function PianoRollEditor({
  track,
  projectId,
  versionId,
  bpm = 120,
  timeSignatureNumerator = 4,
  timeSignatureDenominator = 4,
  onClose,
  onSaved,
  isRenderingMidi = false,
  playing = false,
  currentTimeSec = 0,
  audioContext = null,
  onPlayRequest,
  onPauseRequest,
  onSeek,
  midiStartBar = 0,
}: Props) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(!track.midi_data)
  const [loadError, setLoadError] = useState('')
  const [notes, setNotes] = useState<MidiNote[]>(track.midi_data?.notes ?? [])
  const [instrument, setInstrument] = useState(track.midi_data?.instrument ?? 0)
  const [midiName] = useState(track.midi_data?.name ?? track.name)
  const [totalSixteenths, setTotalSixteenths] = useState(track.midi_data?.totalSixteenths ?? 64)
  const [trackBpm] = useState(track.midi_data?.bpm ?? bpm)
  const [timeSigN] = useState(track.midi_data?.timeSignatureNumerator ?? timeSignatureNumerator)
  const [timeSigD] = useState(track.midi_data?.timeSignatureDenominator ?? timeSignatureDenominator)

  const [mode, setMode] = useState<'draw' | 'select'>('draw')
  const [snap, setSnap] = useState<string>('1/4')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [zoom, setZoom] = useState(1)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [selectionCount, setSelectionCount] = useState(0)
  const [canvasW, setCanvasW] = useState(800)
  const [canvasH] = useState(PITCH_RANGE * NOTE_HEIGHT)

  const sixteenthW = BASE_SIXTEENTH_W * zoom
  const totalCanvasW = totalSixteenths * sixteenthW
  const gridCanvasW = Math.max(totalCanvasW, canvasW)

  // Live refs — drag path avoids React state per frame
  const notesRef = useRef<MidiNote[]>(notes)
  const selectedIdsRef = useRef<Set<string>>(selectedIds)
  const snapRef = useRef(snap)
  const sixteenthWRef = useRef(sixteenthW)
  const modeRef = useRef(mode)
  const marqueeDivRef = useRef<HTMLDivElement>(null)
  const dragStartContainerRectRef = useRef<DOMRect | null>(null)
  const rafDrawRef = useRef(0)
  const accentColorRef = useRef('rgb(232, 93, 58)')
  const isDraggingRef = useRef(false)
  // pendingMarqueeRef removed — marquee is now a DOM div, not a canvas overlay
  const needsNotesRedrawRef = useRef(true)
  const fastDrawRef = useRef(false)
  // Pending drag coords — updated on every mousemove, consumed once per RAF
  const pendingDragXRef = useRef(0)
  const pendingDragYRef = useRef(0)
  const hasPendingDragMoveRef = useRef(false)
  const canvasWRef = useRef(canvasW)
  const canvasHRef = useRef(canvasH)
  const totalSixteenthsRef = useRef(totalSixteenths)

  // Only sync refs from React state when not mid-drag (otherwise we wipe in-flight edits)
  if (!isDraggingRef.current) {
    notesRef.current = notes
    selectedIdsRef.current = selectedIds
  }
  snapRef.current = snap
  sixteenthWRef.current = sixteenthW
  modeRef.current = mode
  canvasWRef.current = canvasW
  canvasHRef.current = canvasH
  totalSixteenthsRef.current = totalSixteenths

  // Dark mode — repaint grid when theme class changes
  const [isDark, setIsDark] = useState(
    typeof document !== 'undefined'
      ? document.documentElement.classList.contains('dark')
      : true
  )
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  // Undo/redo
  const undoStack = useRef<MidiNote[][]>([])
  const redoStack = useRef<MidiNote[][]>([])

  // Canvas refs
  const gridCanvasRef = useRef<HTMLCanvasElement>(null)
  const notesCanvasRef = useRef<HTMLCanvasElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const gridAreaRef = useRef<HTMLDivElement>(null)

  // Drag state
  const dragRef = useRef<{
    type: 'create' | 'move' | 'resize' | 'select' | null
    noteId?: string
    startX: number
    startY: number
    startSixteenth?: number
    startPitch?: number
    currentSixteenth?: number
    currentPitch?: number
    notesBefore?: MidiNote[]
    creating?: MidiNote
    selectRect?: { x1: number; y1: number; x2: number; y2: number }
    movingIds?: Set<string>
  } | null>(null)

  // Playback cursor
  const rafRef = useRef(0)

  // Soundfont
  const instrumentRef = useRef<Player | null>(null)
  const scheduledNotesRef = useRef<AudioScheduledSourceNode[]>([])

  // Save state
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Show instrument dropdown
  const [showInstrumentMenu, setShowInstrumentMenu] = useState(false)
  const instrumentMenuRef = useRef<HTMLDivElement>(null)
  const editorOpenedTrackedRef = useRef(false)

  // ── Load MIDI data if not cached ───────────────────────────────────────────
  useEffect(() => {
    if (track.midi_data) {
      setNotes(track.midi_data.notes)
      setInstrument(track.midi_data.instrument)
      setTotalSixteenths(track.midi_data.totalSixteenths)
      setLoading(false)
      return
    }
    setLoading(true)
    fetch(`/api/tracks/${track.id}/midi`)
      .then(r => r.json())
      .then(data => {
        if (data.midi_data) {
          setNotes(data.midi_data.notes)
          setInstrument(data.midi_data.instrument)
          setTotalSixteenths(data.midi_data.totalSixteenths)
        } else {
          setLoadError(data.error ?? 'Failed to load MIDI')
        }
      })
      .catch(() => setLoadError('Network error'))
      .finally(() => setLoading(false))
  }, [track.id, track.midi_data])

  useEffect(() => {
    if (loading || loadError || editorOpenedTrackedRef.current) return
    editorOpenedTrackedRef.current = true
    trackEvent('midi_editor_opened')
  }, [loading, loadError])

  // ── Load soundfont ─────────────────────────────────────────────────────────
  useEffect(() => {
    loadInstrument(instrument).then(inst => { instrumentRef.current = inst }).catch(console.warn)
  }, [instrument])

  const previewPitch = useCallback(async (pitch: number) => {
    try {
      const actx = getAudioContext()
      if (actx.state === 'suspended') await actx.resume()
      if (!instrumentRef.current) {
        instrumentRef.current = await loadInstrument(instrument)
      }
      instrumentRef.current.play(pitch.toString(), actx.currentTime, { duration: 0.35, gain: 0.85 })
    } catch (err) {
      console.warn('[PianoRollEditor] preview pitch failed:', err)
    }
  }, [instrument])

  // ── Measure canvas width ───────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const obs = new ResizeObserver(() => setCanvasW(el.clientWidth))
    obs.observe(el)
    setCanvasW(el.clientWidth)
    return () => obs.disconnect()
  }, [])

  // Keep wheel gestures inside the piano roll (don't scroll the track list / page).
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.stopPropagation()
      const { scrollTop, scrollHeight, clientHeight, scrollLeft, scrollWidth, clientWidth } = el
      const atTop = scrollTop <= 0
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1
      const atLeft = scrollLeft <= 0
      const atRight = scrollLeft + clientWidth >= scrollWidth - 1
      const dy = e.deltaY
      const dx = e.deltaX
      const blockedY = (dy < 0 && atTop) || (dy > 0 && atBottom)
      const blockedX = (dx < 0 && atLeft) || (dx > 0 && atRight)
      // Dominant axis: block page scroll-chaining when that axis is exhausted.
      if (Math.abs(dy) >= Math.abs(dx) ? blockedY : blockedX) {
        e.preventDefault()
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [loading, loadError])

  // ── Close instrument menu on outside click ─────────────────────────────────
  useEffect(() => {
    if (!showInstrumentMenu) return
    function handler(e: MouseEvent) {
      if (instrumentMenuRef.current && !instrumentMenuRef.current.contains(e.target as Node)) {
        setShowInstrumentMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showInstrumentMenu])

  // ── Undo/redo helpers ──────────────────────────────────────────────────────
  function pushUndo(before: MidiNote[]) {
    undoStack.current.push(JSON.parse(JSON.stringify(before)))
    redoStack.current = []
    if (undoStack.current.length > 50) undoStack.current.shift()
    if (!isDraggingRef.current) setHistoryVersion(v => v + 1)
  }

  function undo() {
    if (!undoStack.current.length) return
    redoStack.current.push(JSON.parse(JSON.stringify(notes)))
    const restored = notesFromSnapshot(undoStack.current.pop()!)
    notesRef.current = restored
    setNotes(restored)
    selectedIdsRef.current = new Set()
    setSelectedIds(new Set())
    setHistoryVersion(v => v + 1)
  }

  function redo() {
    if (!redoStack.current.length) return
    undoStack.current.push(JSON.parse(JSON.stringify(notes)))
    const restored = notesFromSnapshot(redoStack.current.pop()!)
    notesRef.current = restored
    setNotes(restored)
    selectedIdsRef.current = new Set()
    setSelectedIds(new Set())
    setHistoryVersion(v => v + 1)
  }

  // ── Grid drawing ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = gridCanvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = gridCanvasW
    const h = canvasH
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    const whiteKeyBg = isDark ? '#383838' : '#ffffff'
    const blackKeyBg = isDark ? '#141414' : 'rgba(0,0,0,0.06)'
    const rowBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'
    const barLine = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(128,128,128,0.55)'
    const beatLine = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(128,128,128,0.3)'
    const subBeatLine = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(128,128,128,0.1)'

    // Horizontal: pitch row backgrounds
    for (let pitch = MIN_PITCH; pitch <= MAX_PITCH; pitch++) {
      const semitone = pitch % 12
      const y = (MAX_PITCH - pitch) * NOTE_HEIGHT
      ctx.fillStyle = BLACK_SEMITONES_SET.has(semitone) ? blackKeyBg : whiteKeyBg
      ctx.fillRect(0, y, w, NOTE_HEIGHT)
      ctx.strokeStyle = rowBorder
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }

    // Bar / beat grid
    const spb = sixteenthsPerBar(timeSigN, timeSigD)
    for (let s = 0; s <= totalSixteenths; s++) {
      const x = s * sixteenthW
      const isBar = s % spb === 0
      const isBeat = s % 4 === 0

      ctx.strokeStyle = isBar ? barLine : isBeat ? beatLine : subBeatLine
      ctx.lineWidth = isBar ? 1 : 0.5
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
  }, [totalCanvasW, canvasW, canvasH, sixteenthW, totalSixteenths, timeSigN, timeSigD, isDark, gridCanvasW])

  // Resolve --lime to rgb() for canvas — redraw after theme change
  useEffect(() => {
    const probe = document.createElement('span')
    probe.style.display = 'none'
    probe.style.color = 'var(--lime)'
    document.documentElement.appendChild(probe)
    accentColorRef.current = getComputedStyle(probe).color || 'rgb(232, 93, 58)'
    document.documentElement.removeChild(probe)
  }, [isDark])

  function noteRectAt(note: MidiNote, sw: number) {
    return noteRect(note, sw)
  }

  function drawNotesCanvas(
    noteList: MidiNote[],
    selIds: Set<string>,
    sw = sixteenthWRef.current,
    fast = false,
  ) {
    const canvas = notesCanvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const cw = canvasWRef.current
    const ch = canvasHRef.current
    const total = totalSixteenthsRef.current
    const w = Math.max(total * sw, cw)
    const h = ch
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    for (const note of noteList) {
      const { x, y, w: nw, h: nh } = noteRectAt(note, sw)
      const isSelected = selIds.has(note.id)
      ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.9)' : 'rgba(167,139,250,0.85)'
      if (fast) {
        ctx.fillRect(x, y, nw, nh)
      } else {
        ctx.beginPath()
        if (ctx.roundRect) ctx.roundRect(x, y, nw, nh, 2)
        else ctx.rect(x, y, nw, nh)
        ctx.fill()
      }
      if (isSelected) {
        ctx.strokeStyle = accentColorRef.current
        ctx.lineWidth = 2
        if (fast) ctx.strokeRect(x + 0.5, y + 0.5, nw - 1, nh - 1)
        else { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, nw, nh, 2); else ctx.rect(x, y, nw, nh); ctx.stroke() }
      }
      // Resize thumb — always rendered so the user can always grab it
      if (nw > 6) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ctx.fillRect(x + nw - 4, y, 4, nh)
      }
    }
  }

  function flushDraw(fast = false) {
    // Apply at most one pending drag move per frame (RAF-throttles selection hit-test)
    if (hasPendingDragMoveRef.current) {
      hasPendingDragMoveRef.current = false
      processDragMove(pendingDragXRef.current, pendingDragYRef.current)
    }
    if (needsNotesRedrawRef.current) {
      drawNotesCanvas(notesRef.current, selectedIdsRef.current, sixteenthWRef.current, fast)
      needsNotesRedrawRef.current = false
    }
    // Marquee visual is a DOM div updated directly in onWindowMouseMove — no canvas needed.
  }

  function requestNotesRedraw() {
    needsNotesRedrawRef.current = true
    scheduleFrame()
  }

  function scheduleFrame(fast = false) {
    if (fast) fastDrawRef.current = true
    if (rafDrawRef.current) return
    rafDrawRef.current = requestAnimationFrame(() => {
      rafDrawRef.current = 0
      flushDraw(fastDrawRef.current)
      fastDrawRef.current = false
    })
  }

  // Redraw when notes/selection change outside of drag
  useEffect(() => {
    if (isDraggingRef.current) return
    needsNotesRedrawRef.current = true
    scheduleFrame()
    setSelectionCount(selectedIds.size)
  }, [notes, selectedIds, sixteenthW, totalCanvasW, canvasW, canvasH, isDark])

  // ── Mouse coordinate helpers ───────────────────────────────────────────────
  function rawCanvasCoords(clientX: number, clientY: number) {
    const grid = gridAreaRef.current
    if (!grid) return { sx: 0, sy: 0, rawSixth: 0, pitch: 60 }
    const rect = grid.getBoundingClientRect()
    const sx = clientX - rect.left
    const sy = clientY - rect.top
    const rawSixth = sx / sixteenthWRef.current
    const pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, MAX_PITCH - Math.floor(sy / NOTE_HEIGHT)))
    return { sx, sy, rawSixth, pitch }
  }

  function snappedSixth(rawSixth: number, snapDiv: number) {
    return snapSixthFloor(rawSixth, snapDiv)
  }

  function canvasCoords(e: React.MouseEvent) {
    const raw = rawCanvasCoords(e.clientX, e.clientY)
    const snapDiv = SNAP_DIVISIONS[snapRef.current] ?? 16
    return {
      ...raw,
      sixth: snappedSixth(raw.rawSixth, snapDiv),
    }
  }

  function findNoteAt(sx: number, sy: number, noteList = notesRef.current): MidiNote | null {
    const sw = sixteenthWRef.current
    for (let i = noteList.length - 1; i >= 0; i--) {
      const note = noteList[i]
      const { x, y, w, h } = noteRectAt(note, sw)
      if (sx >= x && sx <= x + w && sy >= y && sy <= y + h) return note
    }
    return null
  }

  function isResizeZone(note: MidiNote, sx: number): boolean {
    const { x, w } = noteRectAt(note, sixteenthWRef.current)
    return sx >= x + w - 4 && sx <= x + w
  }

  function commitDrag() {
    const wasCreate = dragRef.current?.type === 'create'
    isDraggingRef.current = false
    hasPendingDragMoveRef.current = false  // discard any coords queued after mouseup
    if (wasCreate) trackEvent('midi_note_drawn')
    setHistoryVersion(v => v + 1)
    setNotes([...notesRef.current])
    setSelectedIds(new Set(selectedIdsRef.current))
    setSelectionCount(selectedIdsRef.current.size)
    needsNotesRedrawRef.current = true
    scheduleFrame()
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return
    const { sx, sy, rawSixth, pitch, sixth } = canvasCoords(e)
    e.preventDefault()
    const snapDiv = SNAP_DIVISIONS[snapRef.current] ?? 16
    const unit = 16 / snapDiv

    if (modeRef.current === 'draw') {
      const hit = findNoteAt(sx, sy)
      if (hit) {
        pushUndo(notesRef.current)
        notesRef.current = notesRef.current.filter(n => n.id !== hit.id)
        trackEvent('midi_note_deleted')
        setNotes([...notesRef.current])
        const s = new Set(selectedIdsRef.current)
        s.delete(hit.id)
        selectedIdsRef.current = s
        setSelectedIds(s)
        requestNotesRedraw()
      } else {
        const newNote: MidiNote = {
          id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          pitch,
          startSixteenth: sixth,
          durationSixteenths: unit,
          velocity: 100,
        }
        pushUndo(notesRef.current)
        notesRef.current = [...notesRef.current, newNote]
        isDraggingRef.current = true
        dragRef.current = {
          type: 'create', startX: sx, startY: sy,
          startSixteenth: sixth, startPitch: pitch,
          creating: newNote, noteId: newNote.id,
        }
        needsNotesRedrawRef.current = true
        flushDraw(true)
        startDragTracking()
      }
    } else {
      const hit = findNoteAt(sx, sy)
      if (!hit) {
        selectedIdsRef.current = new Set()
        isDraggingRef.current = true
        // Cache container rect at drag start so mousemove never calls getBoundingClientRect
        dragStartContainerRectRef.current = gridAreaRef.current?.getBoundingClientRect() ?? null
        dragRef.current = {
          type: 'select', startX: sx, startY: sy,
          selectRect: { x1: sx, y1: sy, x2: sx, y2: sy },
        }
        // Show the marquee div at zero size (grows as mouse moves)
        const div = marqueeDivRef.current
        if (div) {
          div.style.left = `${sx}px`
          div.style.top = `${sy}px`
          div.style.width = '0px'
          div.style.height = '0px'
          div.style.display = 'block'
        }
        // Redraw notes to clear any stale selection highlight
        needsNotesRedrawRef.current = true
        scheduleFrame()
        startDragTracking()
      } else if (isResizeZone(hit, sx)) {
        if (!selectedIdsRef.current.has(hit.id)) {
          selectedIdsRef.current = new Set([hit.id])
        }
        pushUndo(notesRef.current)
        isDraggingRef.current = true
        dragRef.current = {
          type: 'resize', noteId: hit.id, startX: sx, startY: sy,
          notesBefore: JSON.parse(JSON.stringify(notesRef.current)),
        }
        requestNotesRedraw()
        startDragTracking()
      } else {
        const movingIds = selectedIdsRef.current.has(hit.id)
          ? selectedIdsRef.current
          : new Set([hit.id])
        selectedIdsRef.current = movingIds
        pushUndo(notesRef.current)
        isDraggingRef.current = true
        dragRef.current = {
          type: 'move', noteId: hit.id, startX: sx, startY: sy,
          startSixteenth: rawSixth,
          startPitch: pitch,
          notesBefore: JSON.parse(JSON.stringify(notesRef.current)),
          movingIds,
        }
        requestNotesRedraw()
        startDragTracking()
      }
    }
  }

  function processDragMove(clientX: number, clientY: number) {
    const dr = dragRef.current
    if (!dr || !dr.type) return
    const { sx, sy, rawSixth, pitch } = rawCanvasCoords(clientX, clientY)
    const snapDiv = SNAP_DIVISIONS[snapRef.current] ?? 16
    const unit = 16 / snapDiv
    const sw = sixteenthWRef.current

    if (dr.type === 'create' && dr.creating && dr.noteId) {
      const rawDur = rawSixth - dr.startSixteenth!
      const dur = snapDur(Math.max(unit, rawDur), snapDiv)
      const idx = notesRef.current.findIndex(n => n.id === dr.noteId)
      if (idx >= 0) {
        notesRef.current[idx] = { ...notesRef.current[idx], durationSixteenths: dur }
      }
      needsNotesRedrawRef.current = true
    } else if (dr.type === 'move' && dr.notesBefore && dr.movingIds) {
      const deltaSixth = rawSixth - dr.startSixteenth!
      const deltaPitch = pitch - dr.startPitch!
      notesRef.current = dr.notesBefore.map(n => {
        if (!dr.movingIds!.has(n.id)) return n
        const newStart = Math.max(0, snapSixthFloor(n.startSixteenth + deltaSixth, 16))
        const newPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, n.pitch + deltaPitch))
        return { ...n, startSixteenth: newStart, pitch: newPitch }
      })
      needsNotesRedrawRef.current = true
    } else if (dr.type === 'resize' && dr.noteId) {
      const targetNote = notesRef.current.find(n => n.id === dr.noteId)
      if (!targetNote) return
      const rawDur = rawSixth - targetNote.startSixteenth
      const dur = snapDur(Math.max(unit, rawDur), snapDiv)
      const idx = notesRef.current.findIndex(n => n.id === dr.noteId)
      if (idx >= 0) {
        notesRef.current[idx] = { ...notesRef.current[idx], durationSixteenths: dur }
      }
      needsNotesRedrawRef.current = true
    } else if (dr.type === 'select' && dr.selectRect) {
      const rect = { ...dr.selectRect, x2: sx, y2: sy }
      dr.selectRect = rect
      const x1 = Math.min(rect.x1, rect.x2)
      const x2 = Math.max(rect.x1, rect.x2)
      const y1 = Math.min(rect.y1, rect.y2)
      const y2 = Math.max(rect.y1, rect.y2)
      const prevSelected = selectedIdsRef.current
      const newSelected = new Set<string>()
      for (const n of notesRef.current) {
        const { x, y, w, h } = noteRectAt(n, sw)
        if (x < x2 && x + w > x1 && y < y2 && y + h > y1) {
          newSelected.add(n.id)
        }
      }
      const selectionChanged =
        newSelected.size !== prevSelected.size ||
        [...newSelected].some(id => !prevSelected.has(id))
      selectedIdsRef.current = newSelected
      // Marquee visual is handled by the div in onWindowMouseMove — nothing to update here.
      if (selectionChanged) needsNotesRedrawRef.current = true
    }
  }

  const dragHandlersRef = useRef({
    onMove: (_clientX: number, _clientY: number) => {},
    onUp: () => {},
  })

  dragHandlersRef.current.onMove = processDragMove
  dragHandlersRef.current.onUp = () => {
    const hadDrag = dragRef.current !== null
    dragRef.current = null
    const div = marqueeDivRef.current
    if (div) div.style.display = 'none'
    window.removeEventListener('mousemove', onWindowMouseMove)
    window.removeEventListener('mouseup', onWindowMouseUp)
    if (hadDrag) commitDrag()
  }

  const onWindowMouseMove = useCallback((e: MouseEvent) => {
    pendingDragXRef.current = e.clientX
    pendingDragYRef.current = e.clientY
    hasPendingDragMoveRef.current = true

    // Instant visual: update marquee div directly on every mousemove event.
    // No canvas ops, no RAF — just four style assignments.
    // Note hit-testing (which is O(n)) stays deferred to the RAF in flushDraw.
    const dr = dragRef.current
    if (dr?.type === 'select') {
      const cachedRect = dragStartContainerRectRef.current
      const div = marqueeDivRef.current
      if (cachedRect && div) {
        const sx = e.clientX - cachedRect.left
        const sy = e.clientY - cachedRect.top
        const x = Math.min(dr.startX, sx)
        const y = Math.min(dr.startY, sy)
        div.style.left = `${x}px`
        div.style.top = `${y}px`
        div.style.width = `${Math.max(1, Math.abs(sx - dr.startX))}px`
        div.style.height = `${Math.max(1, Math.abs(sy - dr.startY))}px`
      }
    }

    scheduleFrame(true)
  }, [])

  const onWindowMouseUp = useCallback(() => {
    dragHandlersRef.current.onUp()
  }, [])

  function startDragTracking() {
    window.addEventListener('mousemove', onWindowMouseMove, { passive: true })
    window.addEventListener('mouseup', onWindowMouseUp)
  }

  useEffect(() => () => {
    window.removeEventListener('mousemove', onWindowMouseMove)
    window.removeEventListener('mouseup', onWindowMouseUp)
  }, [onWindowMouseMove, onWindowMouseUp])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIdsRef.current.size > 0) {
          pushUndo(notesRef.current)
          notesRef.current = notesRef.current.filter(n => !selectedIdsRef.current.has(n.id))
          trackEvent('midi_note_deleted', { count: selectedIdsRef.current.size })
          selectedIdsRef.current = new Set()
          setNotes([...notesRef.current])
          setSelectedIds(new Set())
          setSelectionCount(0)
        }
      } else if (e.key === 'Escape') {
        selectedIdsRef.current = new Set()
        setSelectedIds(new Set())
        setSelectionCount(0)
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault()
        const all = new Set(notesRef.current.map(n => n.id))
        selectedIdsRef.current = all
        setSelectedIds(all)
        setSelectionCount(all.size)
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') {
        e.preventDefault(); redo()
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault(); undo()
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault(); redo()
      } else if (e.key === ' ') {
        e.preventDefault()
        if (playing) onPauseRequest?.()
        else onPlayRequest?.()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, selectedIds, playing])

  // ── Playback cursor auto-scroll ────────────────────────────────────────────
  useEffect(() => {
    if (!playing) return
    const canvas = notesCanvasRef.current
    if (!canvas) return

    // Auto-scroll to follow cursor during playback.
    // Use midiStartBar offset so we scroll relative to MIDI editor position.
    const sixteenthSec = sixteenthDuration(trackBpm)
    const barDurSec = sixteenthsPerBar(timeSigN, timeSigD) * sixteenthDuration(bpm)
    const editorTimeSec = Math.max(0, currentTimeSec - midiStartBar * barDurSec)
    const cursorX = (editorTimeSec / sixteenthSec) * sixteenthW
    const container = scrollContainerRef.current
    if (container) {
      const cursorContentX = NOTE_HEIGHT + cursorX
      const visibleLeft = container.scrollLeft
      const visibleRight = visibleLeft + container.clientWidth
      if (cursorContentX < visibleLeft + 50 || cursorContentX > visibleRight - 50) {
        container.scrollLeft = Math.max(0, cursorContentX - container.clientWidth * 0.35)
      }
    }
  }, [playing, currentTimeSec, sixteenthW, trackBpm, midiStartBar, bpm, timeSigN, timeSigD])

  // ── Save flow ──────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true)
    setSaveError('')
    try {
      const midiData: MidiTrackData = {
        notes,
        name: midiName,
        instrument,
        totalSixteenths,
        bpm: trackBpm,
        timeSignatureNumerator: timeSigN,
        timeSignatureDenominator: timeSigD,
      }

      // 1. Serialize to MIDI
      const midiBuffer = serializeMidi(midiData)

      // 2. Hash
      const hash = await sha256Hex(midiBuffer)
      const storagePath = `projects/${projectId}/${hash}.mid`

      // 3. Upload raw .mid to R2 via API
      const blob = new Blob([midiBuffer], { type: 'audio/midi' })
      const fd = new FormData()
      fd.append('file', blob, `${hash}.mid`)
      fd.append('storage_path', storagePath)

      const uploadRes = await fetch(`/api/tracks/${track.id}/midi-upload`, {
        method: 'PUT',
        body: fd,
      })
      if (!uploadRes.ok) throw new Error('MIDI upload failed')

      // 4. Update track record
      const patchRes = await fetch(`/api/tracks/${track.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_hash: hash,
          storage_path: storagePath,
          midi_data: midiData,
        }),
      })
      if (!patchRes.ok) throw new Error((await patchRes.json()).error ?? 'Save failed')

      await onSaved({ file_hash: hash, storage_path: storagePath, midi_data: midiData })
      trackEvent('midi_saved', { note_count: notes.length })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Compute selected note stats ────────────────────────────────────────────
  const selectedNotes = notes.filter(n => selectedIds.has(n.id))
  const singleSelected = selectedNotes.length === 1 ? selectedNotes[0] : null

  // ── Bar number labels ──────────────────────────────────────────────────────
  // Labels show project-relative bar numbers (midiStartBar shifts the base)
  const spb = sixteenthsPerBar(timeSigN, timeSigD)
  const barLabels: Array<{ x: number; label: number }> = []
  for (let s = 0; s <= totalSixteenths; s += spb) {
    barLabels.push({ x: s * sixteenthW, label: Math.round(s / spb) + 1 + midiStartBar })
  }

  // ── Playback cursor position ───────────────────────────────────────────────
  // currentTimeSec is project playback time. Convert to MIDI editor position
  // by subtracting the bar offset (computed using the project BPM prop).
  const sixteenthSec = sixteenthDuration(trackBpm)
  const barDurationSec = spb * sixteenthDuration(bpm)  // bpm prop = project BPM
  const midiOffsetSec = midiStartBar * barDurationSec
  const midiEditorTimeSec = Math.max(0, currentTimeSec - midiOffsetSec)
  const cursorX = (midiEditorTimeSec / sixteenthSec) * sixteenthW
  // Hide cursor when project time hasn't reached the MIDI start yet
  const showCursor = playing && currentTimeSec >= midiOffsetSec

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ height: 460, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-surface)' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="animate-pulse" style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--bg-card)', margin: '0 auto 12px' }} />
          <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>Loading MIDI data…</p>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ height: 460, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-surface)' }}>
        <p style={{ fontSize: 13, color: '#ef4444' }}>{loadError}</p>
      </div>
    )
  }

  return (
    <div
      className="bg-surface border-y border-border h-[460px] flex flex-col select-none relative z-[2]"
      style={{ overscrollBehavior: 'contain' }}
    >
      {/* ── Toolbar ── */}
      <div className="h-10 shrink-0 bg-card border-b border-border flex items-center px-3 gap-2.5">
        {/* Mode toggle */}
        <div className="inline-flex border border-border shrink-0">
          {(['draw', 'select'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => {
                if (mode !== m) trackEvent('midi_mode_switched', { mode: m })
                setMode(m)
              }}
              className={`text-[10px] uppercase tracking-widest px-3 py-1.5 transition border-r border-border last:border-r-0 ${
                mode === m
                  ? 'bg-lime text-primary-foreground'
                  : 'text-muted-foreground hover:text-lime hover:bg-lime-soft'
              }`}
            >
              {m === 'draw' ? 'Draw' : 'Select'}
            </button>
          ))}
        </div>

        {/* Snap */}
        <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground shrink-0">
          Snap
          <select
            value={snap}
            onChange={e => setSnap(e.target.value)}
            className="bg-surface border border-border px-2 py-1 text-[10px] uppercase tracking-widest text-foreground outline-none focus:border-lime cursor-pointer"
          >
            {Object.keys(SNAP_DIVISIONS).map(k => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>

        {/* Instrument selector */}
        <div ref={instrumentMenuRef} className="relative flex-1 min-w-0">
          <MidiBtn
            onClick={() => setShowInstrumentMenu(v => !v)}
            className="max-w-[220px] truncate"
          >
            {gmProgramLabel(instrument)}
          </MidiBtn>
          {showInstrumentMenu && (
            <div className="absolute top-full left-0 z-[100] mt-1 w-[220px] max-h-[300px] overflow-y-auto border border-border bg-popover shadow-2xl">
              {GM_PROGRAM_GROUPS.map(group => (
                <div key={group.family}>
                  <div className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                    {group.family}
                  </div>
                  {group.programs.map(p => (
                    <button
                      key={p.num}
                      type="button"
                      onClick={() => {
                        if (instrument !== p.num) trackEvent('midi_instrument_changed', { instrument: p.label })
                        setInstrument(p.num)
                        setShowInstrumentMenu(false)
                      }}
                      className={`block w-full text-left px-4 py-1.5 text-xs transition ${
                        instrument === p.num
                          ? 'text-lime bg-lime-soft'
                          : 'text-muted-foreground hover:bg-surface hover:text-foreground'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Undo / Redo */}
        <MidiBtn
          onClick={undo}
          disabled={historyVersion < 0 || !undoStack.current.length}
          title="Undo (Ctrl+Z)"
        >
          Undo
        </MidiBtn>
        <MidiBtn
          onClick={redo}
          disabled={historyVersion < 0 || !redoStack.current.length}
          title="Redo (Ctrl+Shift+Z)"
        >
          Redo
        </MidiBtn>

        <div className="w-px h-5 bg-border mx-1" />

        <MidiBtn
          onClick={() => {
            trackEvent('midi_edit_cancelled')
            onClose()
          }}
          disabled={saving}
        >
          Cancel
        </MidiBtn>
        <MidiBtnPrimary onClick={handleSave} disabled={saving || isRenderingMidi}>
          {saving ? (isRenderingMidi ? 'Rendering…' : 'Saving…') : 'Done'}
        </MidiBtnPrimary>
        {saveError && (
          <span className="text-[10px] text-destructive max-w-[140px] truncate">
            {saveError}
          </span>
        )}
      </div>

      {/* ── Piano roll area ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div
          ref={scrollContainerRef}
          style={{
            flex: 1,
            overflow: 'scroll',
            minHeight: 0,
            minWidth: 0,
            overscrollBehavior: 'contain',
          }}
        >
          <div style={{ display: 'flex', flexShrink: 0, width: NOTE_HEIGHT + gridCanvasW }}>
            {/* Key column + corner */}
            <div style={{ width: NOTE_HEIGHT, flexShrink: 0 }}>
              <div
                style={{
                  height: BAR_RULER_H,
                  borderBottom: '0.5px solid var(--border)',
                  borderRight: '0.5px solid var(--border)',
                  background: 'var(--bg-card)',
                }}
              />
              <PianoKeyColumn isDark={isDark} onPreviewPitch={previewPitch} />
            </div>

            {/* Bar ruler + grid — scrolls horizontally with keys */}
            <div style={{ width: gridCanvasW, flexShrink: 0 }}>
              <div
                style={{
                  height: BAR_RULER_H,
                  position: 'relative',
                  borderBottom: '0.5px solid var(--border)',
                  background: 'var(--bg-card)',
                }}
              >
                {barLabels.map(({ x, label }) => (
                  <div
                    key={`bar-line-${label}-${x}`}
                    style={{
                      position: 'absolute',
                      left: x,
                      top: 0,
                      bottom: 0,
                      width: 1,
                      background: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(128,128,128,0.55)',
                      pointerEvents: 'none',
                    }}
                  />
                ))}
                {barLabels.map(({ x, label }) => (
                  <div
                    key={`bar-label-${label}-${x}`}
                    style={{
                      position: 'absolute',
                      left: x,
                      top: 0,
                      height: '100%',
                      paddingLeft: 3,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{label}</span>
                  </div>
                ))}
              </div>

              <div
                ref={gridAreaRef}
                style={{
                  position: 'relative',
                  width: gridCanvasW,
                  height: canvasH,
                  cursor: mode === 'draw' ? 'crosshair' : 'default',
                }}
                onMouseDown={handleMouseDown}
              >
                <canvas
                  ref={gridCanvasRef}
                  style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
                />
                <canvas
                  ref={notesCanvasRef}
                  style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
                />
                <div
                  ref={marqueeDivRef}
                  style={{
                    display: 'none',
                    position: 'absolute',
                    pointerEvents: 'none',
                    zIndex: 5,
                    background: 'rgba(232, 93, 58, 0.12)',
                    border: '2px solid var(--lime)',
                    boxSizing: 'border-box',
                  }}
                />
                {showCursor && (
                  <div style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: cursorX, width: 1.5,
                    background: 'rgba(255,255,255,0.8)',
                    pointerEvents: 'none', zIndex: 10,
                  }} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="h-10 shrink-0 bg-card border-t border-border flex items-center px-3.5 gap-4 text-[10px] uppercase tracking-widest">
        {/* Note count */}
        <span className="text-muted-foreground">
          {selectionCount > 0
            ? `${selectionCount} note${selectionCount !== 1 ? 's' : ''} selected`
            : `${notes.length} note${notes.length !== 1 ? 's' : ''} total`}
        </span>

        <div className="flex-1" />

        {/* Zoom controls */}
        <div className="flex items-center gap-2">
          <MidiIconBtn
            onClick={() => setZoom(z => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)))}
            aria-label="Zoom out"
            className="size-6 text-base"
          >
            −
          </MidiIconBtn>
          <span className="text-muted-foreground min-w-10 text-center tabular-nums normal-case tracking-normal">
            {Math.round(zoom * 100)}%
          </span>
          <MidiIconBtn
            onClick={() => setZoom(z => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)))}
            aria-label="Zoom in"
            className="size-6 text-base"
          >
            +
          </MidiIconBtn>
        </div>

        {/* Velocity for selected note */}
        {singleSelected && (
          <div className="flex items-center gap-2 normal-case tracking-normal">
            <span className="text-muted-foreground text-[10px] uppercase tracking-widest">Velocity</span>
            <input
              type="range" min={1} max={127} value={singleSelected.velocity}
              onChange={e => {
                const v = parseInt(e.target.value)
                setNotes(prev => prev.map(n => n.id === singleSelected.id ? { ...n, velocity: v } : n))
              }}
              className="w-20 accent-lime"
            />
            <span className="text-foreground min-w-6 tabular-nums">{singleSelected.velocity}</span>
          </div>
        )}
      </div>
    </div>
  )
}
