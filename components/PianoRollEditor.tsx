'use client'

import {
  useEffect, useRef, useState, useCallback, useLayoutEffect,
} from 'react'
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

const NOTE_HEIGHT = 10
const MIN_PITCH = 21  // A0
const MAX_PITCH = 108 // C8
const PITCH_RANGE = MAX_PITCH - MIN_PITCH + 1  // 88

const SNAP_DIVISIONS: Record<string, number> = {
  '1/4': 4,
  '1/8': 8,
  '1/16': 16,
  '1/32': 32,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function snapToGrid(sixteenth: number, snapDiv: number): number {
  const unit = 16 / snapDiv
  return Math.round(sixteenth / unit) * unit
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

// ─── Piano keyboard canvas ────────────────────────────────────────────────────

const BLACK_SEMITONES_SET = new Set([1, 3, 6, 8, 10])

function PianoKeyboard({
  height,
  onKeyPress,
}: {
  height: number
  onKeyPress: (pitch: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Reactively track dark mode — repaint whenever the theme class changes.
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const W = 40
    canvas.width = W * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, height)

    // Absolute color rules: white keys are ALWAYS light, black keys ALWAYS dark.
    const whiteKeyBg  = isDark ? '#2e2e2e' : '#ffffff'
    const blackKeyBg  = isDark ? '#0a0a0a' : '#1a1a1a'
    const borderColor = isDark ? '#3a3a3a' : '#d0d0d0'
    const labelColor  = isDark ? '#555555' : '#999999'

    // ── Pass 1: white keys (full width, each covers its row) ───────────────
    for (let pitch = MIN_PITCH; pitch <= MAX_PITCH; pitch++) {
      if (BLACK_SEMITONES_SET.has(pitch % 12)) continue
      const y = (MAX_PITCH - pitch) * NOTE_HEIGHT
      ctx.fillStyle = whiteKeyBg
      ctx.fillRect(0, y, W, NOTE_HEIGHT)
      // row separator
      ctx.strokeStyle = borderColor
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(0, y + NOTE_HEIGHT)
      ctx.lineTo(W, y + NOTE_HEIGHT)
      ctx.stroke()
      // C label
      if (pitch % 12 === 0) {
        const octave = Math.floor(pitch / 12) - 1
        ctx.fillStyle = labelColor
        ctx.font = `9px system-ui, sans-serif`
        ctx.textAlign = 'right'
        ctx.fillText(`C${octave}`, W - 3, y + NOTE_HEIGHT - 2)
      }
    }

    // ── Pass 2: black keys on top (60% height, 60% width, centered) ────────
    const bkH = NOTE_HEIGHT * 0.6
    const bkW = W * 0.6
    const bkOffsetY = (NOTE_HEIGHT - bkH) / 2

    for (let pitch = MIN_PITCH; pitch <= MAX_PITCH; pitch++) {
      if (!BLACK_SEMITONES_SET.has(pitch % 12)) continue
      const rowY = (MAX_PITCH - pitch) * NOTE_HEIGHT
      ctx.fillStyle = blackKeyBg
      ctx.fillRect(0, rowY + bkOffsetY, bkW, bkH)
    }

    // ── Right border ────────────────────────────────────────────────────────
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)'
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(W, 0)
    ctx.lineTo(W, height)
    ctx.stroke()
  }, [height, isDark])

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    // getBoundingClientRect already reflects current scroll position of the
    // canvas element, so no manual scrollTop adjustment is needed.
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const pitch = MAX_PITCH - Math.floor(y / NOTE_HEIGHT)
    if (pitch >= MIN_PITCH && pitch <= MAX_PITCH) {
      onKeyPress(pitch)
    }
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: 40, height, display: 'block', flexShrink: 0, cursor: 'pointer' }}
      onClick={handleClick}
    />
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
  onSaved: (updatedTrack: Partial<Track>) => void
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
  const [snap, setSnap] = useState<string>('1/16')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [zoom, setZoom] = useState(1) // multiplier on default sixteenthWidth

  // Undo/redo
  const undoStack = useRef<MidiNote[][]>([])
  const redoStack = useRef<MidiNote[][]>([])

  // Canvas refs
  const gridCanvasRef = useRef<HTMLCanvasElement>(null)
  const notesCanvasRef = useRef<HTMLCanvasElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [canvasW, setCanvasW] = useState(800)
  const [canvasH] = useState(PITCH_RANGE * NOTE_HEIGHT) // total scroll height

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

  // ── Sizing ─────────────────────────────────────────────────────────────────
  const sixteenthW = Math.max(8, Math.min(32, (canvasW / totalSixteenths) * zoom))
  const totalCanvasW = totalSixteenths * sixteenthW

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

  // ── Load soundfont ─────────────────────────────────────────────────────────
  useEffect(() => {
    loadInstrument(instrument).then(inst => { instrumentRef.current = inst }).catch(console.warn)
  }, [instrument])

  // ── Measure canvas width ───────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const obs = new ResizeObserver(() => setCanvasW(el.clientWidth - 40))
    obs.observe(el)
    setCanvasW(el.clientWidth - 40)
    return () => obs.disconnect()
  }, [])

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
  }

  function undo() {
    if (!undoStack.current.length) return
    redoStack.current.push(JSON.parse(JSON.stringify(notes)))
    setNotes(notesFromSnapshot(undoStack.current.pop()!))
    setSelectedIds(new Set())
  }

  function redo() {
    if (!redoStack.current.length) return
    undoStack.current.push(JSON.parse(JSON.stringify(notes)))
    setNotes(notesFromSnapshot(redoStack.current.pop()!))
    setSelectedIds(new Set())
  }

  // ── Grid drawing ───────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = gridCanvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(totalCanvasW, canvasW)
    const h = canvasH
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    // Horizontal: black key row backgrounds
    for (let pitch = MIN_PITCH; pitch <= MAX_PITCH; pitch++) {
      const semitone = pitch % 12
      if (BLACK_SEMITONES_SET.has(semitone)) {
        const y = (MAX_PITCH - pitch) * NOTE_HEIGHT
        ctx.fillStyle = 'rgba(0,0,0,0.07)'
        ctx.fillRect(0, y, w, NOTE_HEIGHT)
      }
      // Row separator line
      const y = (MAX_PITCH - pitch) * NOTE_HEIGHT
      ctx.strokeStyle = 'rgba(128,128,128,0.15)'
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

      ctx.strokeStyle = isBar
        ? 'rgba(128,128,128,0.55)'
        : isBeat
        ? 'rgba(128,128,128,0.3)'
        : 'rgba(128,128,128,0.1)'
      ctx.lineWidth = isBar ? 1 : 0.5
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
    }
  }, [totalCanvasW, canvasW, canvasH, sixteenthW, totalSixteenths, timeSigN, timeSigD])

  // ── Notes drawing ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = notesCanvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(totalCanvasW, canvasW)
    const h = canvasH
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    for (const note of notes) {
      const { x, y, w: nw, h: nh } = noteRect(note, sixteenthW)
      const isSelected = selectedIds.has(note.id)

      // Main body
      ctx.fillStyle = isSelected ? 'rgba(255,255,255,0.9)' : 'rgba(167,139,250,0.85)'
      ctx.beginPath()
      if (ctx.roundRect) {
        ctx.roundRect(x, y, nw, nh, 2)
      } else {
        ctx.rect(x, y, nw, nh)
      }
      ctx.fill()

      if (isSelected) {
        ctx.strokeStyle = 'white'
        ctx.lineWidth = 1
        ctx.stroke()
      }

      // Velocity indicator (darker bar at bottom)
      const velH = nh * (1 - note.velocity / 127)
      if (velH > 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.2)'
        ctx.fillRect(x, y + nh - velH, nw, velH)
      }

      // Resize handle (last 4px)
      if (nw > 6) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ctx.fillRect(x + nw - 4, y, 4, nh)
      }
    }
  }, [notes, selectedIds, sixteenthW, totalCanvasW, canvasW, canvasH])

  // ── Bar number header ──────────────────────────────────────────────────────
  // Drawn as a fixed 20px strip above the scroll area, via CSS absolutely positioned div
  // We derive bar labels from sixteenthW

  // ── Mouse coordinate helpers ───────────────────────────────────────────────
  //
  // Use the scroll CONTAINER rect (viewport-stable) + explicit scroll offsets.
  // DO NOT use getBoundingClientRect on the canvas itself — that rect already
  // moves with scroll, so adding scrollLeft/scrollTop again double-counts.
  //
  const KEYBOARD_W = 40

  function canvasCoords(e: React.MouseEvent): { sx: number; sy: number; sixth: number; pitch: number } {
    const container = scrollContainerRef.current
    if (!container) return { sx: 0, sy: 0, sixth: 0, pitch: 60 }
    const rect = container.getBoundingClientRect()
    // Position inside the scrollable CONTENT area, past the keyboard column.
    const sx = e.clientX - rect.left + container.scrollLeft - KEYBOARD_W
    const sy = e.clientY - rect.top  + container.scrollTop
    const snapDiv = SNAP_DIVISIONS[snap] ?? 16
    const rawSixth = sx / sixteenthW
    const unit = 16 / snapDiv
    const sixth = Math.max(0, Math.round(rawSixth / unit) * unit)
    const pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, MAX_PITCH - Math.floor(sy / NOTE_HEIGHT)))
    return { sx, sy, sixth, pitch }
  }

  function findNoteAt(sx: number, sy: number): MidiNote | null {
    // Iterate in reverse (top notes first)
    for (let i = notes.length - 1; i >= 0; i--) {
      const note = notes[i]
      const { x, y, w, h } = noteRect(note, sixteenthW)
      if (sx >= x && sx <= x + w && sy >= y && sy <= y + h) return note
    }
    return null
  }

  function isResizeZone(note: MidiNote, sx: number): boolean {
    const { x, w } = noteRect(note, sixteenthW)
    return sx >= x + w - 4 && sx <= x + w
  }

  // ── Mouse handlers ─────────────────────────────────────────────────────────
  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return
    const { sx, sy, sixth, pitch } = canvasCoords(e)
    if (sx < 0) return  // click landed on the keyboard strip, not the grid
    e.preventDefault()
    const snapDiv = SNAP_DIVISIONS[snap] ?? 16
    const unit = 16 / snapDiv

    if (mode === 'draw') {
      const hit = findNoteAt(sx, sy)
      if (hit) {
        // Delete the note
        pushUndo(notes)
        setNotes(prev => prev.filter(n => n.id !== hit.id))
        setSelectedIds(prev => { const s = new Set(prev); s.delete(hit.id); return s })
      } else {
        // Create a new note
        const newNote: MidiNote = {
          id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          pitch,
          startSixteenth: sixth,
          durationSixteenths: unit,
          velocity: 100,
        }
        pushUndo(notes)
        setNotes(prev => [...prev, newNote])
        dragRef.current = {
          type: 'create', startX: sx, startY: sy,
          startSixteenth: sixth, startPitch: pitch,
          creating: newNote, noteId: newNote.id,
        }
      }
    } else {
      // SELECT mode
      const hit = findNoteAt(sx, sy)
      if (!hit) {
        // Start rubber-band selection
        setSelectedIds(new Set())
        dragRef.current = {
          type: 'select', startX: sx, startY: sy,
          selectRect: { x1: sx, y1: sy, x2: sx, y2: sy },
        }
      } else if (isResizeZone(hit, sx)) {
        if (!selectedIds.has(hit.id)) setSelectedIds(new Set([hit.id]))
        dragRef.current = {
          type: 'resize', noteId: hit.id, startX: sx, startY: sy,
          notesBefore: JSON.parse(JSON.stringify(notes)),
        }
        pushUndo(notes)
      } else {
        if (!selectedIds.has(hit.id)) setSelectedIds(new Set([hit.id]))
        dragRef.current = {
          type: 'move', noteId: hit.id, startX: sx, startY: sy,
          startSixteenth: sx / sixteenthW,
          startPitch: MAX_PITCH - Math.floor(sy / NOTE_HEIGHT),
          notesBefore: JSON.parse(JSON.stringify(notes)),
        }
        pushUndo(notes)
      }
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    const dr = dragRef.current
    if (!dr || !dr.type) return
    const { sx, sy, sixth, pitch } = canvasCoords(e)
    const snapDiv = SNAP_DIVISIONS[snap] ?? 16
    const unit = 16 / snapDiv

    if (dr.type === 'create' && dr.creating && dr.noteId) {
      const rawDur = (sx - (dr.startSixteenth! * sixteenthW)) / sixteenthW
      const dur = snapDur(Math.max(unit, rawDur), snapDiv)
      setNotes(prev => prev.map(n =>
        n.id === dr.noteId ? { ...n, durationSixteenths: dur } : n
      ))
    } else if (dr.type === 'move') {
      const deltaSixteenth = sx / sixteenthW - dr.startSixteenth!
      const deltaPitch = (MAX_PITCH - Math.floor(sy / NOTE_HEIGHT)) - dr.startPitch!
      const snappedDelta = snapToGrid(deltaSixteenth, snapDiv) - snapToGrid(0, snapDiv)

      setNotes(prev => prev.map(n => {
        if (!selectedIds.has(n.id)) return n
        const newStart = Math.max(0, n.startSixteenth + snappedDelta)
        const newPitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, n.pitch + deltaPitch))
        return { ...n, startSixteenth: newStart, pitch: newPitch }
      }))
    } else if (dr.type === 'resize' && dr.noteId) {
      const targetNote = notes.find(n => n.id === dr.noteId)
      if (!targetNote) return
      const rawDur = (sx - targetNote.startSixteenth * sixteenthW) / sixteenthW
      const dur = snapDur(Math.max(unit, rawDur), snapDiv)
      setNotes(prev => prev.map(n => n.id === dr.noteId ? { ...n, durationSixteenths: dur } : n))
    } else if (dr.type === 'select' && dr.selectRect) {
      const rect = { ...dr.selectRect, x2: sx, y2: sy }
      dr.selectRect = rect
      // Select all notes that intersect
      const x1 = Math.min(rect.x1, rect.x2)
      const x2 = Math.max(rect.x1, rect.x2)
      const y1 = Math.min(rect.y1, rect.y2)
      const y2 = Math.max(rect.y1, rect.y2)
      const newSelected = new Set<string>()
      for (const n of notes) {
        const { x, y, w, h } = noteRect(n, sixteenthW)
        if (x < x2 && x + w > x1 && y < y2 && y + h > y1) {
          newSelected.add(n.id)
        }
      }
      setSelectedIds(newSelected)
    }
  }

  function handleMouseUp() {
    dragRef.current = null
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size > 0) {
          pushUndo(notes)
          setNotes(prev => prev.filter(n => !selectedIds.has(n.id)))
          setSelectedIds(new Set())
        }
      } else if (e.key === 'Escape') {
        setSelectedIds(new Set())
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault()
        setSelectedIds(new Set(notes.map(n => n.id)))
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
      const visibleLeft = container.scrollLeft + 40
      const visibleRight = visibleLeft + container.clientWidth - 40
      if (cursorX < visibleLeft || cursorX > visibleRight - 50) {
        container.scrollLeft = cursorX - 40
      }
    }
  }, [playing, currentTimeSec, sixteenthW, trackBpm, midiStartBar, bpm, timeSigN, timeSigD])

  // ── Key press preview ──────────────────────────────────────────────────────
  async function handleKeyboardNote(pitch: number) {
    try {
      const inst = instrumentRef.current ?? await loadInstrument(instrument)
      const actx = getAudioContext()
      if (actx.state === 'suspended') await actx.resume()
      inst.play(pitch.toString(), actx.currentTime, { duration: 0.5, gain: 0.8 })
    } catch { /* ignore */ }
  }

  // ── MIDI scheduling for transport playback ─────────────────────────────────
  // This is called from page.tsx via the audioContext prop when playing starts
  // For now we expose a schedule function that page.tsx can call

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

      onSaved({ file_hash: hash, storage_path: storagePath, midi_data: midiData })
      onClose()
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
      style={{
        background: 'var(--bg-surface)',
        borderTop: '0.5px solid var(--border)',
        borderBottom: '0.5px solid var(--border)',
        height: 460,
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      } as React.CSSProperties}
    >
      {/* ── Toolbar ── */}
      <div style={{
        height: 40, flexShrink: 0,
        background: 'var(--bg-card)',
        borderBottom: '0.5px solid var(--border)',
        display: 'flex', alignItems: 'center',
        padding: '0 12px', gap: 10,
      }}>
        {/* Mode toggle */}
        <div style={{ display: 'flex', background: 'var(--bg)', borderRadius: 6, padding: 2, gap: 1 }}>
          {(['draw', 'select'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: '3px 9px', borderRadius: 5, fontSize: 11,
                background: mode === m ? 'var(--bg-card)' : 'transparent',
                color: mode === m ? 'var(--text-sec)' : 'var(--text-dim)',
                border: mode === m ? '0.5px solid var(--border)' : 'none',
                cursor: 'pointer', transition: 'all 0.12s',
              }}
            >
              {m === 'draw' ? '✏ Draw' : '↔ Select'}
            </button>
          ))}
        </div>

        {/* Snap */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Snap:</span>
          <select
            value={snap}
            onChange={e => setSnap(e.target.value)}
            style={{
              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
              borderRadius: 5, padding: '2px 6px', fontSize: 11,
              color: 'var(--text-sec)', cursor: 'pointer',
            }}
          >
            {Object.keys(SNAP_DIVISIONS).map(k => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>

        {/* Instrument selector */}
        <div ref={instrumentMenuRef} style={{ position: 'relative', flex: 1 }}>
          <button
            onClick={() => setShowInstrumentMenu(v => !v)}
            style={{
              background: 'var(--bg-card)', border: '0.5px solid var(--border)',
              borderRadius: 5, padding: '3px 10px', fontSize: 11,
              color: 'var(--text-sec)', cursor: 'pointer', maxWidth: 180,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            🎹 {gmProgramLabel(instrument)}
          </button>
          {showInstrumentMenu && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 100, marginTop: 4,
              background: 'var(--bg-surface)', border: '0.5px solid var(--border)',
              borderRadius: 8, width: 220, maxHeight: 300, overflowY: 'auto',
              boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            }}>
              {GM_PROGRAM_GROUPS.map(group => (
                <div key={group.family}>
                  <div style={{ padding: '6px 10px 3px', fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {group.family}
                  </div>
                  {group.programs.map(p => (
                    <button
                      key={p.num}
                      onClick={() => { setInstrument(p.num); setShowInstrumentMenu(false) }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '5px 16px', fontSize: 12,
                        color: instrument === p.num ? 'var(--accent)' : 'var(--text-sec)',
                        background: instrument === p.num ? 'rgba(99,102,241,0.08)' : 'transparent',
                        border: 'none', cursor: 'pointer',
                      }}
                      onMouseEnter={e => { if (instrument !== p.num) e.currentTarget.style.background = 'var(--bg-card)' }}
                      onMouseLeave={e => { if (instrument !== p.num) e.currentTarget.style.background = 'transparent' }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />

        {/* Undo/Redo */}
        <button
          onClick={undo} disabled={!undoStack.current.length}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, padding: '2px 5px', opacity: undoStack.current.length ? 1 : 0.3 }}
          title="Undo (Ctrl+Z)"
        >↺</button>
        <button
          onClick={redo} disabled={!redoStack.current.length}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, padding: '2px 5px', opacity: redoStack.current.length ? 1 : 0.3 }}
          title="Redo (Ctrl+Shift+Z)"
        >↻</button>

        <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

        <button
          onClick={onClose}
          style={{
            background: 'transparent', border: '0.5px solid var(--border)',
            borderRadius: 6, padding: '4px 12px', fontSize: 11,
            color: 'var(--text-muted)', cursor: 'pointer',
          }}
        >Cancel</button>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            background: saving ? 'var(--accent-dim, #4f46e5)' : 'var(--accent)',
            border: 'none', borderRadius: 6, padding: '4px 14px',
            fontSize: 11, fontWeight: 500, color: 'white', cursor: 'pointer',
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saveError && (
          <span style={{ fontSize: 11, color: '#ef4444', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {saveError}
          </span>
        )}
      </div>

      {/* ── Piano roll area ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Bar ruler header (fixed, scrolls horizontally with canvas) */}
        <div style={{ height: 20, background: 'var(--bg-card)', borderBottom: '0.5px solid var(--border)', display: 'flex', flexShrink: 0, overflow: 'hidden' }}>
          {/* Keyboard placeholder */}
          <div style={{ width: 40, flexShrink: 0, borderRight: '0.5px solid var(--border)' }} />
          {/* Bar numbers — horizontally synced with scroll */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', left: -scrollLeft, top: 0, height: '100%', minWidth: Math.max(totalCanvasW, canvasW) }}>
              {barLabels.map(({ x, label }) => (
                <div key={label} style={{ position: 'absolute', left: x, top: 0, height: '100%', paddingLeft: 3, display: 'flex', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main scroll container — also owns all mouse events so coords use its stable rect */}
        <div
          ref={scrollContainerRef}
          style={{ flex: 1, overflow: 'scroll', display: 'flex', cursor: mode === 'draw' ? 'crosshair' : 'default' }}
          onScroll={e => {
            setScrollLeft((e.target as HTMLDivElement).scrollLeft)
            setScrollTop((e.target as HTMLDivElement).scrollTop)
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          {/* Piano keyboard — sticky horizontally, scrolls vertically with the grid */}
          <div style={{ position: 'sticky', left: 0, zIndex: 5, flexShrink: 0 }}>
            <PianoKeyboard
              height={canvasH}
              onKeyPress={handleKeyboardNote}
            />
          </div>

          {/* Canvas area */}
          <div style={{ position: 'relative', flexShrink: 0, width: Math.max(totalCanvasW, canvasW), height: canvasH }}>
            {/* Grid canvas (static layer) */}
            <canvas
              ref={gridCanvasRef}
              style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
            />
            {/* Notes canvas (display layer — interaction handled by scroll container) */}
            <canvas
              ref={notesCanvasRef}
              style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
            />
            {/* Playback cursor */}
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

      {/* ── Footer ── */}
      <div style={{
        height: 40, flexShrink: 0,
        background: 'var(--bg-card)',
        borderTop: '0.5px solid var(--border)',
        display: 'flex', alignItems: 'center',
        padding: '0 14px', gap: 16, fontSize: 11,
      }}>
        {/* Note count */}
        <span style={{ color: 'var(--text-dim)' }}>
          {selectedIds.size > 0
            ? `${selectedIds.size} note${selectedIds.size !== 1 ? 's' : ''} selected`
            : `${notes.length} note${notes.length !== 1 ? 's' : ''} total`}
        </span>

        <div style={{ flex: 1 }} />

        {/* Zoom controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
            style={{ background: 'none', border: '0.5px solid var(--border)', borderRadius: 4, width: 20, height: 20, cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >−</button>
          <span style={{ color: 'var(--text-dim)', minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom(z => Math.min(4, z + 0.25))}
            style={{ background: 'none', border: '0.5px solid var(--border)', borderRadius: 4, width: 20, height: 20, cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >+</button>
        </div>

        {/* Velocity for selected note */}
        {singleSelected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--text-dim)' }}>Velocity:</span>
            <input
              type="range" min={1} max={127} value={singleSelected.velocity}
              onChange={e => {
                const v = parseInt(e.target.value)
                setNotes(prev => prev.map(n => n.id === singleSelected.id ? { ...n, velocity: v } : n))
              }}
              style={{ width: 80, accentColor: 'var(--accent)' }}
            />
            <span style={{ color: 'var(--text-sec)', minWidth: 25 }}>{singleSelected.velocity}</span>
          </div>
        )}
      </div>
    </div>
  )
}
