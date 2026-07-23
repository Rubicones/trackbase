'use client'

// Upload progress row in the track list — extracted verbatim from page.tsx.
import React from 'react'
import { ActionButton } from './mixerChrome'
import { TRACK_LABEL_W, TRACK_ROW_H, formatBytes } from './mixerUtils'
import type { UploadItem } from './mixerTypes'

// ─── Upload progress row ──────────────────────────────────────────────────────

export function UploadRow({ upload, onRetry, onDismiss }: {
  upload: UploadItem
  onRetry: () => void
  onDismiss: () => void
}) {
  const { file, status, progress, error } = upload
  const name = file.name.replace(/\.[^.]+$/, '')
  const isMidi = file.name.endsWith('.mid') || file.name.endsWith('.midi')

  // Subtitle line shown under the track name
  let subtitle: React.ReactNode = null
  if (status === 'pending') {
    subtitle = <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Waiting…</span>
  } else if (status === 'presigning') {
    subtitle = <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Preparing upload…</span>
  } else if (status === 'uploading') {
    const loaded = Math.round(file.size * progress / 100)
    subtitle = (
      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        {formatBytes(loaded)} / {formatBytes(file.size)}
      </span>
    )
  } else if (status === 'processing') {
    subtitle = (
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {isMidi ? 'Parsing MIDI…' : 'Converting to FLAC…'}
      </span>
    )
  } else if (status === 'done') {
    subtitle = <span style={{ fontSize: 11, color: '#22c55e' }}>✓ Done</span>
  } else if (status === 'error') {
    subtitle = <span style={{ fontSize: 11, color: '#ef4444' }}>{error || 'Upload failed'}</span>
  }

  // Waveform-area progress bar (1fr column)
  let waveformArea: React.ReactNode = null
  if (status === 'uploading') {
    waveformArea = (
      <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
        <div style={{
          width: `${progress}%`, height: '100%',
          background: 'var(--accent)', borderRadius: 3,
          transition: 'width 0.2s ease',
        }} />
      </div>
    )
  } else if (status === 'processing') {
    // Bar is 100% filled (upload done); shimmer overlay indicates ongoing work
    waveformArea = (
      <div style={{ height: 6, borderRadius: 3, background: 'var(--accent)', overflow: 'hidden', position: 'relative' }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.2s infinite linear',
        }} />
      </div>
    )
  } else if (status === 'pending' || status === 'presigning') {
    waveformArea = (
      <div className="animate-pulse" style={{ height: 6, borderRadius: 3, background: 'var(--border)' }} />
    )
  }

  return (
    <div
      className="flex border-b border-border"
      style={{ minHeight: TRACK_ROW_H, borderLeft: status === 'error' ? '3px solid var(--destructive)' : undefined }}
    >
      <div className="shrink-0 border-r border-border p-3 flex flex-col justify-center" style={{ width: TRACK_LABEL_W }}>
        <div className="text-xs font-bold uppercase tracking-tight truncate text-muted-foreground">{name}</div>
        <div className="mt-0.5">{subtitle}</div>
      </div>
      <div className="flex-1 flex items-center px-3 min-w-0">
        <div className="flex-1 min-w-0">
          {waveformArea}
        </div>
        {status === 'uploading' && (
          <span className="text-[9px] tabular-nums text-muted-foreground ml-2 shrink-0">{progress}%</span>
        )}
      </div>
      <div className="shrink-0 border-l border-border flex items-center px-2">
        {status === 'error' && (
          <div className="flex items-center gap-1">
            <ActionButton label="R" tooltip="Retry upload" onClick={onRetry} />
            <ActionButton label="C" tooltip="Dismiss" onClick={onDismiss} />
          </div>
        )}
      </div>
    </div>
  )
}
