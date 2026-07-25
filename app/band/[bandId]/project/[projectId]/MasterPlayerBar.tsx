'use client'

// Bottom transport bar (play/seek/volume/metronome/count-in/loop) — extracted verbatim from page.tsx.
import React, { useEffect, useRef } from 'react'
import { SectionLabel } from '@/components/design/AppShell'
import { Spinner } from '@/components/ui/Spinner'
import { TransportToggle } from './mixerChrome'
import { fmtTime } from './mixerUtils'

export function MasterPlayerBar({
  playing, currentTime, currentTimeRef, duration, loaded, total, volume,
  onPlay, onPause, onSeek, onVolume,
  metronomeOn, countdownOn, isCounting,
  onToggleMetronome, onToggleCountdown,
  sectionLoopOn, sectionLoopEnabled, onToggleSectionLoop,
  compact = false,
  playbackReady = false,
  playbackMix = 'full',
}: {
  playing: boolean; currentTime: number
  /** Updated every rAF — used to drive the progress bar DOM directly. */
  currentTimeRef: React.RefObject<number>
  duration: number; loaded: number; total: number; volume: number
  onPlay: () => void; onPause: () => void; onSeek: (t: number) => void; onVolume: (v: number) => void
  metronomeOn: boolean; countdownOn: boolean; isCounting: boolean
  onToggleMetronome: () => void; onToggleCountdown: () => void
  sectionLoopOn: boolean; sectionLoopEnabled: boolean; onToggleSectionLoop: () => void
  compact?: boolean
  /** True when the transport can start (all stems decoded OR preview mix loaded). */
  playbackReady?: boolean
  /** Which mix the transport would play right now. */
  playbackMix?: 'preview' | 'full' | 'none'
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const fillRefC = useRef<HTMLDivElement>(null)   // compact version
  const cursorRef = useRef<HTMLDivElement>(null)
  const cursorRefC = useRef<HTMLDivElement>(null) // compact version
  const draggingRef = useRef(false)
  const seekPreviewRef = useRef<number | null>(null)
  const durationRef = useRef(duration)
  durationRef.current = duration
  const isLoading = loaded < total && total > 0
  // Stems still fetching but the cached preview mix is playable — let the user
  // play/seek the preview instead of waiting, and show the badge over the bar.
  const previewActive = isLoading && playbackReady && playbackMix === 'preview'
  const canTransport = !isLoading || previewActive
  const playLoading = isLoading && !previewActive && !playing && !isCounting
  const playBtnClass = playLoading
    ? 'size-10 border border-border bg-background grid place-items-center cursor-wait'
    : 'size-10 bg-lime text-primary-foreground grid place-items-center active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed'

  function handleTransportClick() {
    if (playing || isCounting) {
      onPause()
      return
    }
    if (canTransport && duration > 0) onPlay()
  }

  // Drive progress bar fill + cursor via rAF — no React state per frame.
  useEffect(() => {
    let raf: number
    function update() {
      const ct = seekPreviewRef.current ?? currentTimeRef.current ?? 0
      const dur = durationRef.current
      const pct = dur > 0 ? Math.min(1, ct / dur) * 100 : 0
      const w = `${pct}%`
      if (fillRef.current)   fillRef.current.style.width   = w
      if (fillRefC.current)  fillRefC.current.style.width  = w
      if (cursorRef.current) cursorRef.current.style.left  = w
      if (cursorRefC.current) cursorRefC.current.style.left = w
      raf = requestAnimationFrame(update)
    }
    raf = requestAnimationFrame(update)
    return () => cancelAnimationFrame(raf)
  // Intentionally stable — reads refs, not state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function clientXToPct(clientX: number) {
    const r = barRef.current?.getBoundingClientRect()
    if (!r) return 0
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width))
  }

  function startDrag(clientX: number) {
    if (!canTransport) return
    draggingRef.current = true
    seekPreviewRef.current = clientXToPct(clientX) * durationRef.current
  }
  function moveDrag(clientX: number) {
    if (!draggingRef.current) return
    seekPreviewRef.current = clientXToPct(clientX) * durationRef.current
  }
  function commitDrag() {
    if (!draggingRef.current) return
    draggingRef.current = false
    const t = seekPreviewRef.current
    seekPreviewRef.current = null
    if (t !== null) onSeek(t)
  }

  // "tracks loading · preview mix" badge — floats above the bottom progress bar
  // while stems fetch and the preview mix is what would play (mirrors the mobile
  // mixer's transport badge above the play button).
  const previewBadge = previewActive ? (
    <span
      className={`absolute ${compact ? '-top-5' : '-top-6'} left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1 uppercase tracking-widest text-[8.5px] px-1.5 py-px border border-border bg-surface text-muted-foreground whitespace-nowrap pointer-events-none`}
    >
      tracks loading · preview mix
    </span>
  ) : null

  const transportToggles = (
    <div className="flex items-center gap-1.5 shrink-0">
      <TransportToggle
        label="Metro"
        active={metronomeOn}
        onClick={onToggleMetronome}
        tooltip="Metronome click track"
      />
      <TransportToggle
        label="Count-in"
        active={countdownOn}
        onClick={onToggleCountdown}
        tooltip="One-bar count-in before play"
      />
      <TransportToggle
        label="Loop"
        active={sectionLoopOn}
        onClick={onToggleSectionLoop}
        tooltip={sectionLoopOn ? 'Stop looping this section' : 'Loops structure sections only'}
        disabled={!sectionLoopEnabled}
      />
      {isCounting && (
        <span className="text-[9px] uppercase tracking-widest text-amber shrink-0">Count-in…</span>
      )}
    </div>
  )

  if (compact) {
    return (
      <div className="border-t border-border bg-surface/60 px-3 flex items-center gap-2 shrink-0 h-10">
        {transportToggles}
        <button
          type="button"
          onClick={handleTransportClick}
          disabled={duration <= 0}
          className={`${playBtnClass} shrink-0`}
          aria-label={playLoading ? 'Loading' : (playing || isCounting) ? 'Pause' : 'Play'}
        >
          {playLoading ? (
            <Spinner size={14} tone="lime" />
          ) : (
            <span className="text-sm translate-x-px">{(playing || isCounting) ? '❚❚' : '▶'}</span>
          )}
        </button>
        <div
          ref={barRef}
          className={`flex-1 min-w-0 h-1 bg-surface-2 relative select-none ${canTransport ? 'cursor-pointer' : 'cursor-default pointer-events-none'}`}
          onMouseDown={e => startDrag(e.clientX)}
          onMouseMove={e => moveDrag(e.clientX)}
          onMouseUp={commitDrag}
          onMouseLeave={commitDrag}
          onTouchStart={e => startDrag(e.touches[0].clientX)}
          onTouchMove={e => moveDrag(e.touches[0].clientX)}
          onTouchEnd={commitDrag}
        >
          {previewBadge}
          <div ref={fillRefC} className="absolute inset-y-0 left-0 bg-lime" style={{ width: '0%' }} />
          <div ref={cursorRefC} className="absolute top-0 bottom-0 w-px bg-foreground" style={{ left: '0%' }} />
        </div>
        <span className="text-[10px] font-mono tabular-nums text-muted-foreground shrink-0 w-[4.5rem] text-right">
          {fmtTime(currentTime)}
        </span>
      </div>
    )
  }

  return (
    <div className="border-t border-border bg-surface/60 px-4 sm:px-6 py-3 hidden landscape:flex sm:flex items-center gap-3 sm:gap-6 flex-wrap shrink-0">
      <div className="flex items-center gap-3">
        {transportToggles}
        <button
          type="button"
          onClick={handleTransportClick}
          disabled={duration <= 0}
          className={playBtnClass}
          aria-label={playLoading ? 'Loading' : (playing || isCounting) ? 'Pause' : 'Play'}
        >
          {playLoading ? (
            <Spinner size={14} tone="lime" />
          ) : (
            <span className="text-sm translate-x-px">{(playing || isCounting) ? '❚❚' : '▶'}</span>
          )}
        </button>
        <div className="font-mono text-xs tabular-nums">
          <span className="text-foreground">{fmtTime(currentTime)}</span>
          <span className="text-muted-foreground"> / {fmtTime(duration)}</span>
        </div>
      </div>

      <div
        ref={barRef}
        className={`flex-1 min-w-[200px] h-2 bg-surface-2 relative select-none ${canTransport ? 'cursor-pointer' : 'cursor-default pointer-events-none'}`}
        onMouseDown={e => startDrag(e.clientX)}
        onMouseMove={e => moveDrag(e.clientX)}
        onMouseUp={commitDrag}
        onMouseLeave={commitDrag}
      >
        {previewBadge}
        <div ref={fillRef} className="absolute inset-y-0 left-0 bg-lime" style={{ width: '0%' }} />
        <div ref={cursorRef} className="absolute top-0 bottom-0 w-px bg-foreground" style={{ left: '0%' }} />
      </div>

      <div className="flex items-center gap-3">
        <SectionLabel>VOL</SectionLabel>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={e => onVolume(parseFloat(e.target.value))}
          className="w-24 accent-lime"
        />
        <span className="text-[10px] text-muted-foreground tabular-nums w-8">{Math.round(volume * 100)}</span>
      </div>
    </div>
  )
}
