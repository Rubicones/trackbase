'use client'

import { useEffect, useRef, useState } from 'react'
import type { MidiTrackData } from '@/lib/types'
import { sixteenthDuration, sixteenthsPerBar } from '@/lib/midi'

interface Props {
  midiData: MidiTrackData
  color: string
  /** Project BPM — used to convert note times to real seconds */
  projectBpm?: number
  /**
   * Total project duration in milliseconds.
   * This is the SAME value used by the bar-grid overlay so that bar N
   * in the preview visually aligns with bar N in the structure ruler.
   */
  totalProjectMs?: number
  height?: number
  /** Bar offset in the project timeline (0 = starts at project bar 1) */
  midiStartBar?: number
}

/**
 * Mini piano-roll preview that fills its container width.
 * Note X positions are mapped to the project timeline (not the MIDI file's
 * internal bar count) so they line up with the structure overlay bar grid.
 */
export default function MiniPianoRoll({
  midiData,
  color,
  projectBpm,
  totalProjectMs,
  height = 34,
  midiStartBar = 0,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)

  // Measure wrapper width and update whenever it resizes.
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      setWidth(entries[0].contentRect.width)
    })
    obs.observe(el)
    setWidth(el.offsetWidth)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!width) return
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width  = width  * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    const { notes } = midiData
    if (!notes.length) return

    // ── Timeline conversion ────────────────────────────────────────────────
    // Convert each note's MIDI-time position into project-time milliseconds,
    // then express as a fraction of the total project duration.
    //
    // Use project BPM so note positions match audio waveforms and playback scheduling.
    const timelineBpm = projectBpm ?? midiData.bpm ?? 120
    const sixteenthMs  = sixteenthDuration(timelineBpm) * 1000

    // Total duration in ms: prefer the passed-in track content duration so the
    // preview fills its container (sized to match audio tracks on the project grid).
    const totalMs = totalProjectMs && totalProjectMs > 0
      ? totalProjectMs
      : midiData.totalSixteenths * sixteenthMs

    // Start offset in sixteenths (project time signature)
    const spbCount = sixteenthsPerBar(
      midiData.timeSignatureNumerator,
      midiData.timeSignatureDenominator,
    )
    const startOffsetSixteenths = midiStartBar * spbCount
    const startOffsetMs = startOffsetSixteenths * sixteenthMs

    // ── Pitch range for Y mapping ──────────────────────────────────────────
    const pitches  = notes.map(n => n.pitch)
    const minPitch = Math.max(0,   Math.min(...pitches) - 4)
    const maxPitch = Math.min(127, Math.max(...pitches) + 4)
    const pitchRange = Math.max(maxPitch - minPitch, 8)

    // ── Draw notes ─────────────────────────────────────────────────────────
    ctx.globalAlpha = 0.85
    ctx.fillStyle   = color

    for (const note of notes) {
      const noteStartMs = startOffsetMs + note.startSixteenth    * sixteenthMs
      const noteDurMs   = note.durationSixteenths * sixteenthMs

      // Skip notes that start after the project ends
      if (noteStartMs >= totalMs) continue

      // X: position as fraction of total project timeline
      const x = (noteStartMs / totalMs) * width
      // Clip width at end of project
      const clippedDurMs = Math.min(noteDurMs, totalMs - noteStartMs)
      const w = Math.max(1.5, (clippedDurMs / totalMs) * width - 0.5)

      // Y: pitch mapped to canvas height (higher pitch → lower y)
      const pitchFraction = (note.pitch - minPitch) / pitchRange
      const noteH = Math.max(1.5, height / pitchRange)
      const y = height - pitchFraction * height - noteH

      ctx.beginPath()
      if (ctx.roundRect) {
        ctx.roundRect(x, y, w, noteH, 1)
      } else {
        ctx.rect(x, y, w, noteH)
      }
      ctx.fill()
    }

    ctx.globalAlpha = 1
  }, [midiData, color, projectBpm, totalProjectMs, width, height, midiStartBar])

  return (
    <div ref={wrapperRef} style={{ width: '100%', height, flexShrink: 1, minWidth: 0 }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height, display: 'block' }}
      />
    </div>
  )
}
