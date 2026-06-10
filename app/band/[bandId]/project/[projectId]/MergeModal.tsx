'use client'

import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrackSnapshot {
  id: string
  name: string
  display_name: string | null
  original_filename: string | null
  file_size_bytes: number | null
  created_at: string
}

export interface ConflictTrack {
  trackName: string
  fileConflict: boolean
  renameConflict: boolean
  mainTrack: TrackSnapshot
  branchTrack: TrackSnapshot
  baseTrack: TrackSnapshot | null
}

export interface AutoMergeItem {
  action: 'take_from_branch' | 'add_new' | 'apply_rename'
  trackName: string
  track: { id: string; name: string; display_name: string | null; original_filename: string | null }
  newDisplayName?: string
}

export interface MergePreview {
  conflicts: ConflictTrack[]
  autoMerge: AutoMergeItem[]
  branchName: string
  mainName: string
  branchVersionId: string
  mainVersionId: string
  branchCommentCount: number
}

// Per-track resolution (both choices are optional — only required when the
// corresponding conflict flag is true)
type Resolution = {
  fileChoice?: 'main' | 'branch'
  nameChoice?: 'main' | 'branch'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtSize(b: number | null) {
  if (!b) return ''
  return b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`
}

function fmtDate(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 172800) return 'yesterday'
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' })
}

const ACCENT       = '#6366F1'
const CONFLICT_RED = '#ef4444'
const CONFLICT_AMB = '#f59e0b'

// ─── Mini static waveform ─────────────────────────────────────────────────────

function MiniWaveform({ trackId, color }: { trackId: string; color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const barsRef   = useRef<number[]>([])
  const [ready, setReady] = useState(false)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const actx = new AudioContext()
        const res = await fetch(`/api/tracks/${trackId}/stream`)
        const ab = await res.arrayBuffer()
        const decoded = await actx.decodeAudioData(ab)
        const raw = decoded.getChannelData(0)
        const N = 48
        const block = Math.floor(raw.length / N)
        const amps: number[] = []
        for (let i = 0; i < N; i++) {
          let s = 0
          for (let j = 0; j < block; j++) s += Math.abs(raw[i * block + j])
          amps.push(s / block)
        }
        const max = Math.max(...amps, 0.001)
        if (!cancelled) { barsRef.current = amps.map(a => a / max); setReady(true) }
        actx.close()
      } catch { /* silent */ }
    }
    load()
    return () => { cancelled = true }
  }, [trackId])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.offsetWidth || 180
    const h = canvas.offsetHeight || 28
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)
    const barW = 2
    const gap = 2
    const step = barW + gap
    const count = Math.floor((w + gap) / step)
    const bars = barsRef.current
    const opacity = isDark ? 0.7 : 0.65
    for (let i = 0; i < count; i++) {
      const amp = bars[Math.floor(i * bars.length / count)] ?? 0
      const bh = Math.max(2, amp * h * 0.85)
      ctx.globalAlpha = opacity
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(i * step, (h - bh) / 2, barW, bh, barW / 2)
      ctx.fill()
    }
  }, [ready, color, isDark])

  return (
    <div className="relative" style={{ height: 28 }}>
      <canvas ref={canvasRef} className="w-full block" style={{ height: 28 }} />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-start pl-1 pointer-events-none">
          <svg className="animate-spin opacity-30" width="10" height="10" viewBox="0 0 10 10" fill="none">
            <circle cx="5" cy="5" r="3.5" stroke={color} strokeWidth="1.5" strokeOpacity="0.3" />
            <path d="M5 1.5A3.5 3.5 0 0 1 8.5 5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  )
}

// ─── File conflict card (existing side-by-side UI) ────────────────────────────

function FileConflictCard({
  label,
  track,
  chosen,
  onChoose,
}: {
  label: 'MAIN' | 'BRANCH'
  track: TrackSnapshot
  chosen: boolean
  onChoose: () => void
}) {
  const color  = chosen ? ACCENT : '#6b7280'
  const bg     = chosen ? 'rgba(99,102,241,0.08)' : 'transparent'
  const border = chosen ? `0.5px solid ${ACCENT}` : '0.5px solid var(--border)'

  return (
    <div
      className="flex-1 rounded-xl p-3 flex flex-col gap-2 transition-all duration-150"
      style={{ background: bg, border }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-semibold tracking-widest uppercase" style={{ color }}>
          {label}
        </span>
        {chosen && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5.5" fill={ACCENT} />
            <path d="M3.5 6l2 2 3-3" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div>
        <div className="text-[12px] font-medium truncate" style={{ color: 'var(--text-soft)' }}>
          {track.original_filename ?? track.name}
        </div>
        <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
          {fmtDate(track.created_at)}{track.file_size_bytes ? ` · ${fmtSize(track.file_size_bytes)}` : ''}
        </div>
      </div>
      <MiniWaveform trackId={track.id} color={color} />
      <button
        onClick={onChoose}
        className="w-full rounded-lg py-1.5 text-[11px] font-medium transition-all duration-150"
        style={{
          background: chosen ? ACCENT : 'transparent',
          border: chosen ? `0.5px solid ${ACCENT}` : '0.5px solid var(--border)',
          color: chosen ? 'white' : 'var(--text-muted)',
          cursor: 'pointer',
        }}
        onMouseEnter={e => { if (!chosen) { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = ACCENT } }}
        onMouseLeave={e => { if (!chosen) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' } }}
      >
        {chosen ? '✓ Keeping this' : 'Keep this'}
      </button>
    </div>
  )
}

// ─── Rename conflict pills ────────────────────────────────────────────────────

function RenameConflictPills({
  mainName,
  branchName,
  chosen,
  onChoose,
}: {
  mainName: string
  branchName: string
  chosen: 'main' | 'branch' | undefined
  onChoose: (c: 'main' | 'branch') => void
}) {
  return (
    <div className="flex gap-3">
      {(['main', 'branch'] as const).map(side => {
        const label = side === 'main' ? 'FROM MAIN' : 'FROM BRANCH'
        const name  = side === 'main' ? mainName   : branchName
        const sel   = chosen === side
        return (
          <div
            key={side}
            className="flex-1 rounded-lg p-4 flex flex-col gap-3 transition-all duration-150"
            style={{
              background: sel
                ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-card))'
                : 'var(--bg-card)',
              border: sel ? `0.5px solid ${ACCENT}` : '0.5px solid var(--border)',
            }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest m-0"
              style={{ color: sel ? ACCENT : 'var(--text-dim)' }}>
              {label}
            </p>
            <p className="text-[14px] font-medium m-0" style={{ color: 'var(--text)' }}>
              &ldquo;{name}&rdquo;
            </p>
            <button
              onClick={() => onChoose(side)}
              className="w-full rounded-lg py-1.5 text-[11px] font-medium transition-all duration-150"
              style={{
                background: sel ? ACCENT : 'transparent',
                border: sel ? `0.5px solid ${ACCENT}` : '0.5px solid var(--border)',
                color: sel ? 'white' : 'var(--text-muted)',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { if (!sel) { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = ACCENT } }}
              onMouseLeave={e => { if (!sel) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' } }}
            >
              {sel ? '✓ Keep this' : 'Keep this'}
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ─── MergeModal ───────────────────────────────────────────────────────────────

export function MergeModal({
  projectId,
  preview,
  onClose,
  onMerged,
}: {
  projectId: string
  preview: MergePreview
  onClose: () => void
  onMerged: (result: { tracksUpdated: number; branchName: string }) => void
}) {
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  const [merging, setMerging]         = useState(false)
  const [mergeErr, setMergeErr]       = useState('')

  function setFileChoice(trackName: string, choice: 'main' | 'branch') {
    setResolutions(r => ({ ...r, [trackName]: { ...r[trackName], fileChoice: choice } }))
  }
  function setNameChoice(trackName: string, choice: 'main' | 'branch') {
    setResolutions(r => ({ ...r, [trackName]: { ...r[trackName], nameChoice: choice } }))
  }

  const unresolvedCount = preview.conflicts.filter(c =>
    (c.fileConflict   && !resolutions[c.trackName]?.fileChoice) ||
    (c.renameConflict && !resolutions[c.trackName]?.nameChoice)
  ).length
  const canMerge = unresolvedCount === 0 && !merging

  async function handleMerge() {
    if (!canMerge) return
    setMerging(true)
    setMergeErr('')
    try {
      const res = await fetch(`/api/projects/${projectId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchVersionId: preview.branchVersionId,
          resolutions: Object.entries(resolutions).map(([trackName, { fileChoice, nameChoice }]) => ({
            trackName,
            ...(fileChoice && { fileChoice }),
            ...(nameChoice && { nameChoice }),
          })),
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        setMergeErr(e.error ?? 'Merge failed')
        return
      }
      const data = await res.json()
      onMerged({ tracksUpdated: data.tracks_updated ?? 0, branchName: preview.branchName })
    } catch {
      setMergeErr('Network error')
    } finally {
      setMerging(false)
    }
  }

  const hasConflicts = preview.conflicts.length > 0

  // ── Clean merge confirm ──────────────────────────────────────────────────────
  if (!hasConflicts) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="rounded-2xl p-5 w-[380px]" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border-light)' }}>
          <p className="text-[15px] font-semibold mb-1" style={{ color: 'var(--text-bright)' }}>
            Merge &ldquo;{preview.branchName}&rdquo; into main
          </p>
          <p className="text-[12px] mb-5" style={{ color: 'var(--text-dim)' }}>No conflicts — ready to merge</p>

          <div className="rounded-xl mb-5 overflow-hidden" style={{ border: '0.5px solid var(--border)' }}>
            {preview.autoMerge.length === 0 ? (
              <div className="px-4 py-3 text-[12px]" style={{ color: 'var(--text-dim)' }}>
                No track changes — branch is identical to main
              </div>
            ) : preview.autoMerge.map((item, i) => (
              <div key={i} className="flex items-start gap-2.5 px-4 py-2.5"
                style={{ borderBottom: i < preview.autoMerge.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                <svg className="shrink-0 mt-0.5" width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <circle cx="6.5" cy="6.5" r="6" fill="rgba(99,102,241,0.15)" />
                  <path d="M4 6.5l2 2 3-3" stroke={ACCENT} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div>
                  <span className="text-[12px] font-medium" style={{ color: 'var(--text-soft)' }}>{item.trackName}</span>
                  <span className="text-[11px] ml-2" style={{ color: 'var(--text-dim)' }}>
                    {item.action === 'add_new'       ? 'new track will be added'
                    : item.action === 'apply_rename'  ? `renamed → "${item.newDisplayName}"`
                    : 'replaced with branch version'}
                  </span>
                  {item.action === 'apply_rename' && item.track.display_name !== item.track.name && (
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
                      &ldquo;{item.track.name}&rdquo; → &ldquo;{item.newDisplayName}&rdquo;
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Comments section */}
          {preview.branchCommentCount > 0 && (
            <div style={{ marginTop: 16 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Comments
              </p>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'rgba(16,185,129,0.06)', border: '0.5px solid rgba(16,185,129,0.2)',
                borderRadius: 8, padding: '8px 12px',
              }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <circle cx="6" cy="6" r="5.5" stroke="#10B981" strokeWidth="0.9" />
                  <path d="M3.5 6l2 2 3-3" stroke="#10B981" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {preview.branchCommentCount} comment{preview.branchCommentCount !== 1 ? 's' : ''} from branch will be added to main
                </span>
              </div>
            </div>
          )}

          {mergeErr && <p className="text-[12px] mb-3" style={{ color: '#ef4444' }}>{mergeErr}</p>}

          <div className="flex gap-2 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-[12px] transition-colors duration-150"
              style={{ border: '0.5px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', background: 'transparent' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >Cancel</button>
            <button
              onClick={handleMerge}
              disabled={merging}
              className="px-5 py-1.5 rounded-lg text-[12px] font-medium text-white disabled:opacity-50 transition-opacity"
              style={{ background: ACCENT, border: `0.5px solid ${ACCENT}`, cursor: merging ? 'not-allowed' : 'pointer' }}
            >
              {merging ? (
                <span className="flex items-center gap-1.5">
                  <svg className="animate-spin" width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <circle cx="5.5" cy="5.5" r="4" stroke="white" strokeWidth="1.5" strokeOpacity="0.3" />
                    <path d="M5.5 1.5A4 4 0 0 1 9.5 5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  Merging…
                </span>
              ) : 'Merge →'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Conflict resolver ────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div
        className="w-full flex flex-col rounded-2xl overflow-hidden"
        style={{
          maxWidth: 660,
          maxHeight: '90vh',
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border-light)',
        }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 shrink-0" style={{ borderBottom: '0.5px solid var(--border)' }}>
          <p className="text-[15px] font-semibold" style={{ color: 'var(--text-bright)' }}>
            Merge &ldquo;{preview.branchName}&rdquo; into main
          </p>
          <p className="text-[12px] mt-0.5" style={{ color: unresolvedCount > 0 ? CONFLICT_AMB : 'var(--text-dim)' }}>
            {unresolvedCount > 0
              ? `Resolve ${unresolvedCount} conflict${unresolvedCount > 1 ? 's' : ''} before merging`
              : 'All conflicts resolved — ready to merge'}
          </p>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          {/* Conflicts */}
          {preview.conflicts.map((conflict) => {
            const res = resolutions[conflict.trackName] ?? {}
            const fileResolved   = !conflict.fileConflict   || !!res.fileChoice
            const renameResolved = !conflict.renameConflict || !!res.nameChoice
            const fullyResolved  = fileResolved && renameResolved

            // Badge label + colours
            const badgeLabel = conflict.fileConflict && conflict.renameConflict
              ? 'FILE + RENAME CONFLICT'
              : conflict.fileConflict
              ? 'FILE CONFLICT'
              : 'RENAME CONFLICT'
            const badgeBg = fullyResolved
              ? 'rgba(34,197,94,0.12)'
              : conflict.fileConflict && conflict.renameConflict
              ? 'rgba(239,68,68,0.12)'
              : conflict.fileConflict
              ? 'rgba(245,158,11,0.12)'
              : 'rgba(99,102,241,0.12)'
            const badgeColor = fullyResolved
              ? 'var(--green)'
              : conflict.fileConflict && conflict.renameConflict
              ? CONFLICT_RED
              : conflict.fileConflict
              ? CONFLICT_AMB
              : ACCENT

            const mainDisplayName   = conflict.mainTrack.display_name   ?? conflict.mainTrack.name
            const branchDisplayName = conflict.branchTrack.display_name ?? conflict.branchTrack.name

            return (
              <div key={conflict.trackName}>
                {/* Conflict header */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: fullyResolved ? 'var(--green)' : CONFLICT_RED }} />
                  <span className="text-[13px] font-medium" style={{ color: 'var(--text-soft)' }}>
                    {conflict.trackName}
                  </span>
                  <span className="text-[9px] font-semibold tracking-widest uppercase px-[7px] py-[2px] rounded ml-auto"
                    style={{ background: badgeBg, color: badgeColor }}>
                    {fullyResolved ? 'RESOLVED' : badgeLabel}
                  </span>
                </div>

                {/* CASE A / C — File conflict: show side-by-side waveform cards */}
                {conflict.fileConflict && (
                  <div className="flex gap-3">
                    <FileConflictCard
                      label="MAIN"
                      track={conflict.mainTrack}
                      chosen={res.fileChoice === 'main'}
                      onChoose={() => setFileChoice(conflict.trackName, 'main')}
                    />
                    <FileConflictCard
                      label="BRANCH"
                      track={conflict.branchTrack}
                      chosen={res.fileChoice === 'branch'}
                      onChoose={() => setFileChoice(conflict.trackName, 'branch')}
                    />
                  </div>
                )}

                {/* CASE B / C — Rename conflict: show name pills */}
                {conflict.renameConflict && (
                  <>
                    {conflict.fileConflict && (
                      <>
                        <div style={{ height: '0.5px', background: 'var(--border)', margin: '12px 0 8px' }} />
                        <p className="text-[12px] m-0 mb-2" style={{ color: 'var(--text-muted)' }}>
                          This track was also renamed:
                        </p>
                      </>
                    )}
                    {!conflict.fileConflict && (
                      <p className="text-[12px] m-0 mb-3" style={{ color: 'var(--text-muted)' }}>
                        Choose a name for this track:
                      </p>
                    )}
                    <RenameConflictPills
                      mainName={mainDisplayName}
                      branchName={branchDisplayName}
                      chosen={res.nameChoice}
                      onChoose={c => setNameChoice(conflict.trackName, c)}
                    />
                  </>
                )}
              </div>
            )
          })}

          {/* Comments section */}
          {preview.branchCommentCount > 0 && (
            <div style={{ marginTop: 0 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Comments
              </p>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'rgba(16,185,129,0.06)', border: '0.5px solid rgba(16,185,129,0.2)',
                borderRadius: 8, padding: '8px 12px',
              }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <circle cx="6" cy="6" r="5.5" stroke="#10B981" strokeWidth="0.9" />
                  <path d="M3.5 6l2 2 3-3" stroke="#10B981" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {preview.branchCommentCount} comment{preview.branchCommentCount !== 1 ? 's' : ''} from branch will be added to main
                </span>
              </div>
            </div>
          )}

          {/* Auto-merge items */}
          {preview.autoMerge.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border: '0.5px solid var(--border)' }}>
              {preview.autoMerge.map((item, i) => (
                <div key={i} className="flex items-start gap-2.5 px-4 py-2.5"
                  style={{ borderBottom: i < preview.autoMerge.length - 1 ? '0.5px solid var(--border)' : 'none' }}
                >
                  <svg className="shrink-0 mt-0.5" width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <circle cx="6.5" cy="6.5" r="6" fill="rgba(34,197,94,0.15)" />
                    <path d="M4 6.5l2 2 3-3" stroke="var(--green)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <span className="text-[12px] font-medium" style={{ color: 'var(--text-soft)' }}>
                      {item.trackName}
                    </span>
                    {item.action === 'apply_rename' ? (
                      <p className="text-[11px] mt-0.5 m-0" style={{ color: 'var(--text-muted)' }}>
                        Display name will change: &ldquo;{item.track.name}&rdquo; → &ldquo;{item.newDisplayName}&rdquo;
                      </p>
                    ) : null}
                  </div>
                  <span className="text-[10px] uppercase tracking-wide font-semibold shrink-0 px-[7px] py-[2px] rounded"
                    style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--green)' }}
                  >
                    {item.action === 'add_new'
                      ? 'AUTO · NEW'
                      : item.action === 'apply_rename'
                      ? 'AUTO · RENAMED'
                      : 'AUTO · FROM BRANCH'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 shrink-0 flex items-center justify-between gap-3"
          style={{ borderTop: '0.5px solid var(--border)' }}>
          {mergeErr
            ? <p className="text-[12px]" style={{ color: '#ef4444' }}>{mergeErr}</p>
            : <div />
          }
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-[12px] transition-colors duration-150"
              style={{ border: '0.5px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', background: 'transparent' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >Cancel</button>
            <button
              onClick={handleMerge}
              disabled={!canMerge}
              className="px-5 py-1.5 rounded-lg text-[12px] font-medium text-white disabled:opacity-40 transition-all duration-150"
              style={{
                background: canMerge ? '#22c55e' : 'var(--border)',
                border: `0.5px solid ${canMerge ? '#22c55e' : 'var(--border)'}`,
                cursor: canMerge ? 'pointer' : 'not-allowed',
              }}
            >
              {merging ? (
                <span className="flex items-center gap-1.5">
                  <svg className="animate-spin" width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <circle cx="5.5" cy="5.5" r="4" stroke="white" strokeWidth="1.5" strokeOpacity="0.3" />
                    <path d="M5.5 1.5A4 4 0 0 1 9.5 5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  Merging…
                </span>
              ) : unresolvedCount > 0
                ? `Merge (${unresolvedCount} conflict${unresolvedCount > 1 ? 's' : ''} left)`
                : 'Merge →'
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
