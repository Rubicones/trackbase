'use client'

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useTheme } from 'next-themes'
import type { BarState } from '@/lib/sectionMerge'
import { formatTrackStartBar } from '@/lib/trackMerge'
import { SectionLabel } from '@/components/design/AppShell'
import { UserAvatar } from '@/components/ui/avatar'
import type { MergePreview, MergeResolution, AutoMergeItem, ConflictTrack, TrackSnapshot, CommentPreview, CommentChanges } from '@/lib/mergePreview'
import type { Version } from '@/lib/types'
import { trackEvent } from '@/lib/analytics'
import { MergePreviewLoading, MergeTargetSelector } from '@/components/merge/MergeTargetSelector'
import { useMergePreview } from '@/components/merge/useMergePreview'
import { mergeTargetVersions } from '@/lib/versionSort'
import { WaveformBarRow, downsampleWaveformBars } from '@/components/WaveformBars'

export type {
  MergePreview,
  ConflictTrack,
  AutoMergeItem,
  CommentPreview,
  CommentChanges,
} from '@/lib/mergePreview'

type Resolution = MergeResolution

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

function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`
}

function trackTitle(t: { display_name?: string | null; name: string }): string {
  return t.display_name?.trim() || t.name
}

function sectionLabel(state: BarState | null): string {
  if (!state) return 'empty'
  if (state.type === 'custom' && state.customName) return state.customName
  return state.type.charAt(0).toUpperCase() + state.type.slice(1)
}

function rangeKey(r: { startBar: number; endBar: number }) {
  return `${r.startBar}-${r.endBar}`
}

function trackConflictKinds(conflict: ConflictTrack): string[] {
  const kinds: string[] = []
  if (conflict.fileConflict) kinds.push('FILE')
  if (conflict.renameConflict) kinds.push('RENAME')
  if (conflict.offsetConflict) kinds.push('OFFSET')
  return kinds
}

function autoMergeDescription(item: AutoMergeItem): string {
  if (item.action === 'add_new') return 'new track will be added'
  if (item.action === 'apply_rename') return `renamed → "${item.newDisplayName}"`
  if (item.action === 'apply_offset') {
    const from = formatTrackStartBar(item.previousStartBar ?? 0)
    const to = formatTrackStartBar(item.newStartBar ?? 0)
    return `starts at ${from} → ${to}`
  }
  return 'replaced with version content'
}

function autoMergeBadge(item: AutoMergeItem): string {
  if (item.action === 'add_new') return 'AUTO · NEW'
  if (item.action === 'apply_rename') return 'AUTO · RENAMED'
  if (item.action === 'apply_offset') return 'AUTO · OFFSET'
  return 'AUTO · FROM VERSION'
}

function MergeShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[8000] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className={`w-full border border-border bg-popover shadow-2xl flex flex-col max-h-[90vh] ${wide ? 'max-w-[660px]' : 'max-w-md'}`}>
        {children}
      </div>
    </div>
  )
}

function MergeTitle({ branchName, targetName }: { branchName: string; targetName: string }) {
  return (
    <h2 className="font-display text-lg uppercase tracking-tight text-foreground m-0">
      Apply &ldquo;{branchName}&rdquo; → &ldquo;{targetName}&rdquo;
    </h2>
  )
}

function AutoCheckIcon() {
  return (
    <svg className="shrink-0 mt-0.5 text-lime" width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="12" height="12" className="fill-lime/15" />
      <path
        d="M4 6.5l2 2 3-3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SectionTag({ state }: { state: BarState | null }) {
  if (!state) return <span className="text-[11px] text-muted-foreground">cleared</span>
  return (
    <span className="tb-section-name text-[9px] uppercase tracking-widest px-2 py-0.5 border border-lime/40 text-lime bg-lime/10">
      {sectionLabel(state)}
    </span>
  )
}

function MergeListBox({ children }: { children: ReactNode }) {
  return <div className="border border-border overflow-hidden">{children}</div>
}

function MergeListRow({ children, last }: { children: ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center gap-2.5 px-4 py-2.5 ${last ? '' : 'border-b border-border'}`}>
      {children}
    </div>
  )
}

function MergeBtn({
  children, variant = 'ghost', disabled, onClick, className = '',
}: {
  children: ReactNode
  variant?: 'ghost' | 'primary' | 'selected'
  disabled?: boolean
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  className?: string
}) {
  const base = 'text-[10px] uppercase tracking-widest transition disabled:opacity-50 disabled:pointer-events-none inline-flex items-center gap-1.5 px-3 py-1.5'
  const styles = {
    ghost: 'border border-border text-muted-foreground hover:border-lime hover:text-lime',
    primary: 'bg-lime text-primary-foreground border border-lime font-display font-bold',
    selected: 'border border-lime text-lime bg-lime-soft font-medium',
  }
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={`${base} ${styles[variant]} ${className}`}>
      {children}
    </button>
  )
}

// ─── Mini static waveform ─────────────────────────────────────────────────────

function MiniWaveform({ trackId, color }: { trackId: string; color: string }) {
  const barsRef = useRef<number[]>([])
  const [ready, setReady] = useState(false)

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

  const bars = ready ? downsampleWaveformBars(barsRef.current, 48) : Array.from({ length: 48 }, () => 0.15)

  return (
    <div className="relative h-7">
      <WaveformBarRow
        bars={bars}
        color={color}
        progress={ready ? 1 : 0}
        className="h-full"
        animate={ready}
      />
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

// ─── File conflict card ───────────────────────────────────────────────────────

function FileConflictCard({
  label, track, chosen, onChoose,
}: {
  label: 'MASTER' | 'VERSION'
  track: TrackSnapshot
  chosen: boolean
  onChoose: () => void
}) {
  return (
    <div
      className={`flex-1 border p-3 flex flex-col gap-2 transition-colors ${
        chosen ? 'border-lime bg-lime-soft/40' : 'border-border bg-background'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-[9px] font-bold tracking-widest uppercase ${chosen ? 'text-lime' : 'text-muted-foreground'}`}>
          {label}
        </span>
        {chosen && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <circle cx="6" cy="6" r="5.5" className="fill-lime" />
            <path d="M3.5 6l2 2 3-3" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div>
        <div className="text-xs font-medium truncate text-foreground">{trackTitle(track)}</div>
        <div className="text-[10px] mt-0.5 text-muted-foreground font-mono">
          {fmtDate(track.created_at)}{track.file_size_bytes ? ` · ${fmtSize(track.file_size_bytes)}` : ''}
          {' · '}{formatTrackStartBar(track.start_bar)}
        </div>
      </div>
      <MiniWaveform trackId={track.id} color={chosen ? 'var(--lime)' : '#6b7280'} />
      <MergeBtn variant={chosen ? 'primary' : 'ghost'} onClick={onChoose} className="w-full justify-center">
        {chosen ? '✓ Keeping this' : 'Keep this'}
      </MergeBtn>
    </div>
  )
}

// ─── Rename conflict pills ────────────────────────────────────────────────────

function RenameConflictPills({
  mainName, branchName, chosen, onChoose,
}: {
  mainName: string
  branchName: string
  chosen: 'main' | 'branch' | undefined
  onChoose: (c: 'main' | 'branch') => void
}) {
  return (
    <div className="flex gap-3">
      {(['main', 'branch'] as const).map(side => {
        const label = side === 'main' ? 'FROM MASTER' : 'FROM VERSION'
        const name  = side === 'main' ? mainName   : branchName
        const sel   = chosen === side
        return (
          <div
            key={side}
            className={`flex-1 border p-4 flex flex-col gap-3 transition-colors ${
              sel ? 'border-lime bg-lime-soft/40' : 'border-border bg-background'
            }`}
          >
            <p className={`text-[10px] font-bold uppercase tracking-widest m-0 ${sel ? 'text-lime' : 'text-muted-foreground'}`}>{label}</p>
            <p className="text-sm font-medium m-0 text-foreground">&ldquo;{name}&rdquo;</p>
            <MergeBtn variant={sel ? 'primary' : 'ghost'} onClick={() => onChoose(side)} className="w-full justify-center">
              {sel ? '✓ Keep this' : 'Keep this'}
            </MergeBtn>
          </div>
        )
      })}
    </div>
  )
}

// ─── Offset conflict pills ────────────────────────────────────────────────────

function OffsetConflictPills({
  mainStartBar, branchStartBar, chosen, onChoose,
}: {
  mainStartBar: number
  branchStartBar: number
  chosen: 'main' | 'branch' | undefined
  onChoose: (c: 'main' | 'branch') => void
}) {
  return (
    <div className="flex gap-3">
      {(['main', 'branch'] as const).map(side => {
        const label = side === 'main' ? 'FROM MASTER' : 'FROM VERSION'
        const bar = side === 'main' ? mainStartBar : branchStartBar
        const sel = chosen === side
        return (
          <div
            key={side}
            className={`flex-1 border p-4 flex flex-col gap-3 transition-colors ${
              sel ? 'border-lime bg-lime-soft/40' : 'border-border bg-background'
            }`}
          >
            <p className={`text-[10px] font-bold uppercase tracking-widest m-0 ${sel ? 'text-lime' : 'text-muted-foreground'}`}>{label}</p>
            <p className="text-sm font-medium m-0 text-foreground font-mono tabular-nums">{formatTrackStartBar(bar)}</p>
            <MergeBtn variant={sel ? 'primary' : 'ghost'} onClick={() => onChoose(side)} className="w-full justify-center">
              {sel ? '✓ Keep this' : 'Keep this'}
            </MergeBtn>
          </div>
        )
      })}
    </div>
  )
}

// ─── Section conflict pill ────────────────────────────────────────────────────

function SectionStatePill({
  label, state, chosen, onChoose,
}: {
  label: 'MASTER' | 'VERSION'
  state: BarState | null
  chosen: boolean
  onChoose: () => void
}) {
  return (
    <div
      className={`flex-1 border p-3 flex flex-col gap-2 transition-colors cursor-pointer ${
        chosen ? 'border-lime bg-lime-soft/30' : 'border-border bg-background'
      }`}
      onClick={onChoose}
    >
      <div className="flex items-center justify-between">
        <span className={`text-[9px] font-bold tracking-widest uppercase ${chosen ? 'text-lime' : 'text-muted-foreground'}`}>
          {label}
        </span>
        {chosen && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <circle cx="6" cy="6" r="5.5" className="fill-lime" />
            <path d="M3.5 6l2 2 3-3" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div className="flex items-center gap-2 min-h-[22px]">
        {state ? (
          <>
            <SectionTag state={state} />
            {state.chords && (
              <span className="text-[10px] truncate text-muted-foreground font-mono">{state.chords}</span>
            )}
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground">no section</span>
        )}
      </div>
      <MergeBtn
        variant={chosen ? 'primary' : 'ghost'}
        onClick={e => { e.stopPropagation(); onChoose() }}
        className="w-full justify-center"
      >
        {chosen ? '✓ Keeping this' : 'Keep this'}
      </MergeBtn>
    </div>
  )
}

// ─── Comment changes section ──────────────────────────────────────────────────

function CommentRow({ c }: { c: CommentPreview }) {
  const author = c.author_username ?? 'unknown'
  return (
    <div className="flex items-start gap-2 px-3 py-2">
      <UserAvatar seed={author} size={20} kind="user" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
          <span className="text-[11px] font-medium text-foreground">{author}</span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] tabular-nums text-lime">{fmtMs(c.timecode_start_ms)}</span>
          <span className="text-[10px] text-muted-foreground truncate">{c.track_name}</span>
          {c.reply_count > 0 && (
            <span className="text-[10px] text-muted-foreground">· {c.reply_count} repl{c.reply_count !== 1 ? 'ies' : 'y'}</span>
          )}
        </div>
        <p className="m-0 text-[11px] text-muted-foreground truncate">{c.content}</p>
      </div>
    </div>
  )
}

function CommentChangesSection({
  commentChanges,
  commentDeletionChoice,
  onDeletionChoiceChange,
  showAddedDetail,
  onToggleAddedDetail,
  showDeletedDetail,
  onToggleDeletedDetail,
}: {
  commentChanges: CommentChanges
  commentDeletionChoice: 'keep' | 'apply'
  onDeletionChoiceChange: (c: 'keep' | 'apply') => void
  showAddedDetail: boolean
  onToggleAddedDetail: () => void
  showDeletedDetail: boolean
  onToggleDeletedDetail: () => void
}) {
  const { added, deleted } = commentChanges
  if (added.length === 0 && deleted.length === 0) return null
  return (
    <div>
      <div className="mb-2"><SectionLabel>Comments</SectionLabel></div>

      {added.length > 0 && (
        <div className={deleted.length > 0 ? 'mb-2' : ''}>
          <div className="flex items-center gap-2 bg-lime-soft/40 border border-lime/30 px-3 py-2">
            <AutoCheckIcon />
            <span className="text-xs text-foreground flex-1">
              {added.length} comment{added.length !== 1 ? 's' : ''} from version will be added to Master
            </span>
            <button
              type="button"
              onClick={onToggleAddedDetail}
              className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-lime"
            >
              {showAddedDetail ? 'Hide ▴' : 'Details ▾'}
            </button>
          </div>
          {showAddedDetail && (
            <MergeListBox>
              {added.map((c, i) => (
                <div key={c.id} className={i < added.length - 1 ? 'border-b border-border' : ''}>
                  <CommentRow c={c} />
                </div>
              ))}
            </MergeListBox>
          )}
        </div>
      )}

      {deleted.length > 0 && (
        <div>
          <div className="flex items-center gap-2 bg-surface border border-border px-3 py-2">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0 text-lime" aria-hidden>
              <path d="M6 2.5V7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              <circle cx="6" cy="9.5" r="0.75" fill="currentColor" />
            </svg>
            <span className="text-xs text-foreground flex-1">
              {deleted.length} comment{deleted.length !== 1 ? 's were' : ' was'} deleted in version
            </span>
            <button
              type="button"
              onClick={onToggleDeletedDetail}
              className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-lime"
            >
              {showDeletedDetail ? 'Hide ▴' : 'Details ▾'}
            </button>
          </div>
          <div className="flex gap-2 mt-2">
            <MergeBtn
              variant={commentDeletionChoice === 'keep' ? 'selected' : 'ghost'}
              onClick={() => onDeletionChoiceChange('keep')}
            >
              Keep in Master
            </MergeBtn>
            <MergeBtn
              variant={commentDeletionChoice === 'apply' ? 'selected' : 'ghost'}
              onClick={() => onDeletionChoiceChange('apply')}
            >
              Apply deletions
            </MergeBtn>
          </div>
          {showDeletedDetail && (
            <div className="mt-2">
              <MergeListBox>
                {deleted.map((c, i) => (
                  <div key={c.id} className={i < deleted.length - 1 ? 'border-b border-border' : ''}>
                    <CommentRow c={c} />
                  </div>
                ))}
              </MergeListBox>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── MergeModal ───────────────────────────────────────────────────────────────

export function MergeModal({
  projectId,
  branchId,
  versions,
  onClose,
  onMerged,
}: {
  projectId: string
  branchId: string
  versions: Version[]
  onClose: () => void
  onMerged: (result: { tracksUpdated: number; branchName: string; targetName: string }) => void
}) {
  const defaultTargetId = useMemo(
    () => versions.find(v => v.type === 'main')?.id ?? mergeTargetVersions(versions, branchId)[0]?.id ?? '',
    [versions, branchId],
  )
  const [targetVersionId, setTargetVersionId] = useState(defaultTargetId)
  const { preview, loading: previewLoading, error: previewError } = useMergePreview(
    projectId,
    branchId,
    targetVersionId,
  )

  const [resolutions, setResolutions]               = useState<Record<string, Resolution>>({})
  const [sectionResolutions, setSectionResolutions] = useState<Record<string, 'main' | 'branch'>>({})
  const [merging, setMerging]                       = useState(false)
  const [mergeErr, setMergeErr]                     = useState('')
  const [commentDeletionChoice, setCommentDeletionChoice] = useState<'keep' | 'apply'>('keep')
  const [showAddedDetail, setShowAddedDetail]             = useState(false)
  const [showDeletedDetail, setShowDeletedDetail]         = useState(false)

  useEffect(() => {
    setResolutions({})
    setSectionResolutions({})
    setCommentDeletionChoice('keep')
    setShowAddedDetail(false)
    setShowDeletedDetail(false)
    setMergeErr('')
  }, [targetVersionId])

  function targetSelectorRow() {
    const branchName = preview?.branchName ?? versions.find(v => v.id === branchId)?.name ?? 'branch'
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{branchName} →</span>
        <MergeTargetSelector
          branchId={branchId}
          versions={versions}
          targetId={targetVersionId}
          onTargetChange={setTargetVersionId}
          disabled={merging || previewLoading}
        />
      </div>
    )
  }

  if (!preview && (previewLoading || !previewError)) {
    return (
      <MergeShell>
        <div className="p-5">
          <MergeTitle branchName={versions.find(v => v.id === branchId)?.name ?? 'branch'} targetName="…" />
          {targetSelectorRow()}
          <MergePreviewLoading />
          <div className="flex justify-end mt-4">
            <MergeBtn variant="ghost" onClick={onClose}>Cancel</MergeBtn>
          </div>
        </div>
      </MergeShell>
    )
  }

  if (!preview && previewError) {
    return (
      <MergeShell>
        <div className="p-5">
          <MergeTitle branchName={versions.find(v => v.id === branchId)?.name ?? 'branch'} targetName="…" />
          {targetSelectorRow()}
          <p className="text-[12px] my-4 text-destructive">{previewError}</p>
          <div className="flex justify-end">
            <MergeBtn variant="ghost" onClick={onClose}>Close</MergeBtn>
          </div>
        </div>
      </MergeShell>
    )
  }

  if (!preview) return null

  function setFileChoice(trackName: string, choice: 'main' | 'branch') {
    setResolutions(r => ({ ...r, [trackName]: { ...r[trackName], fileChoice: choice } }))
  }
  function setNameChoice(trackName: string, choice: 'main' | 'branch') {
    setResolutions(r => ({ ...r, [trackName]: { ...r[trackName], nameChoice: choice } }))
  }
  function setOffsetChoice(trackName: string, choice: 'main' | 'branch') {
    setResolutions(r => ({ ...r, [trackName]: { ...r[trackName], offsetChoice: choice } }))
  }
  function setSectionChoice(key: string, choice: 'main' | 'branch') {
    setSectionResolutions(r => ({ ...r, [key]: choice }))
  }

  const unresolvedTrackCount = preview.conflicts.filter(c =>
    (c.fileConflict   && !resolutions[c.trackName]?.fileChoice) ||
    (c.renameConflict && !resolutions[c.trackName]?.nameChoice) ||
    (c.offsetConflict && !resolutions[c.trackName]?.offsetChoice)
  ).length

  const sectionConflicts = preview.sectionBarConflicts ?? []
  const sectionAutoItems = preview.sectionAutoFromBranch ?? []
  const unresolvedSectionCount = sectionConflicts.filter(
    c => !sectionResolutions[rangeKey(c)]
  ).length

  const unresolvedCount = unresolvedTrackCount + unresolvedSectionCount
  const canMerge = unresolvedCount === 0 && !merging && !previewLoading

  async function handleMerge() {
    if (!canMerge || !preview) return
    const p = preview
    const hadConflicts = p.conflicts.length > 0 || (p.sectionBarConflicts ?? []).length > 0
    setMerging(true)
    setMergeErr('')
    try {
      const res = await fetch(`/api/projects/${projectId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchVersionId: p.branchVersionId,
          target_version_id: p.targetVersionId,
          resolutions: Object.entries(resolutions).map(([trackName, { fileChoice, nameChoice, offsetChoice }]) => ({
            trackName,
            ...(fileChoice && { fileChoice }),
            ...(nameChoice && { nameChoice }),
            ...(offsetChoice && { offsetChoice }),
          })),
          sectionResolutions: Object.entries(sectionResolutions).map(([key, choice]) => {
            const [startBar, endBar] = key.split('-').map(Number)
            return { startBar, endBar, choice }
          }),
          ...((p.commentChanges?.deleted.length ?? 0) > 0 && { commentDeletionChoice }),
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        setMergeErr(e.error ?? 'Apply failed')
        return
      }
      const data = await res.json()
      trackEvent('merge_completed', { had_conflicts: hadConflicts })
      onMerged({ tracksUpdated: data.tracks_updated ?? 0, branchName: p.branchName, targetName: p.targetVersionName })
    } catch {
      setMergeErr('Network error')
    } finally {
      setMerging(false)
    }
  }

  const hasConflicts = preview.conflicts.length > 0 || sectionConflicts.length > 0

  // ── Clean merge confirm ────────────────────────────────────────────────────
  if (!hasConflicts) {
    return (
      <MergeShell>
        <div className="p-6 overflow-y-auto">
          <MergeTitle branchName={preview.branchName} targetName={preview.targetVersionName} />
          {targetSelectorRow()}
          {previewLoading ? (
            <MergePreviewLoading label="Updating comparison…" />
          ) : (
          <>
          <p className="text-xs text-muted-foreground mt-1 mb-5 m-0">No overlapping changes — ready to apply</p>

          {preview.autoMerge.length > 0 && (
            <>
              <div className="mb-2"><SectionLabel>Tracks</SectionLabel></div>
              <MergeListBox>
                {preview.autoMerge.map((item, i) => (
                  <MergeListRow key={i} last={i === preview.autoMerge.length - 1}>
                    <AutoCheckIcon />
                    <div>
                      <span className="text-xs font-medium text-foreground">{trackTitle(item.track)}</span>
                      <span className="text-[11px] ml-2 text-muted-foreground">{autoMergeDescription(item)}</span>
                    </div>
                  </MergeListRow>
                ))}
              </MergeListBox>
              <div className="mb-4" />
            </>
          )}

          {sectionAutoItems.length > 0 && (
            <>
              <div className="mb-2"><SectionLabel>Structure</SectionLabel></div>
              <MergeListBox>
                {sectionAutoItems.map((item, i) => (
                  <MergeListRow key={i} last={i === sectionAutoItems.length - 1}>
                    <AutoCheckIcon />
                    <span className="text-xs text-foreground font-mono tabular-nums">
                      Bars {item.startBar + 1}–{item.endBar}
                    </span>
                    <span className="text-[11px] text-muted-foreground">→</span>
                    <SectionTag state={item.branchState} />
                  </MergeListRow>
                ))}
              </MergeListBox>
              <div className="mb-4" />
            </>
          )}

          {preview.autoMerge.length === 0 && sectionAutoItems.length === 0 &&
            !(preview.commentChanges?.added.length || preview.commentChanges?.deleted.length) && (
            <div className="border border-border px-4 py-3 text-xs text-muted-foreground mb-4">
              No changes — version is identical to Master
            </div>
          )}

          {preview.commentChanges && (
            <div className="mb-4">
              <CommentChangesSection
                commentChanges={preview.commentChanges}
                commentDeletionChoice={commentDeletionChoice}
                onDeletionChoiceChange={setCommentDeletionChoice}
                showAddedDetail={showAddedDetail}
                onToggleAddedDetail={() => setShowAddedDetail(v => !v)}
                showDeletedDetail={showDeletedDetail}
                onToggleDeletedDetail={() => setShowDeletedDetail(v => !v)}
              />
            </div>
          )}

          </>
          )}

          {mergeErr && <p className="text-xs text-destructive mb-3 m-0">{mergeErr}</p>}

          <div className="flex gap-2 justify-end pt-2 border-t border-border">
            <MergeBtn onClick={onClose}>Cancel</MergeBtn>
            <MergeBtn variant="primary" disabled={!canMerge} onClick={handleMerge}>
              {merging ? 'Applying…' : 'Apply →'}
            </MergeBtn>
          </div>
        </div>
      </MergeShell>
    )
  }

  // ── Conflict resolver ──────────────────────────────────────────────────────
  return (
    <MergeShell wide>
      <div className="px-5 pt-5 pb-4 shrink-0 border-b border-border">
        <MergeTitle branchName={preview.branchName} targetName={preview.targetVersionName} />
        {targetSelectorRow()}
        <p className={`text-xs mt-1 m-0 ${previewLoading ? 'text-muted-foreground' : unresolvedCount > 0 ? 'text-lime' : 'text-muted-foreground'}`}>
          {previewLoading
            ? 'Updating comparison…'
            : unresolvedCount > 0
            ? `Review ${unresolvedCount} overlapping change${unresolvedCount > 1 ? 's' : ''} before applying`
            : 'All overlapping changes reviewed — ready to apply'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
        {previewLoading ? (
          <MergePreviewLoading label="Updating comparison…" />
        ) : (
        <>
        {preview.conflicts.length > 0 && (
          <div className="flex flex-col gap-4">
            <SectionLabel>Tracks</SectionLabel>
            {preview.conflicts.map((conflict) => {
              const res = resolutions[conflict.trackName] ?? {}
              const fileResolved   = !conflict.fileConflict   || !!res.fileChoice
              const renameResolved = !conflict.renameConflict || !!res.nameChoice
              const offsetResolved = !conflict.offsetConflict || !!res.offsetChoice
              const fullyResolved  = fileResolved && renameResolved && offsetResolved
              const kinds = trackConflictKinds(conflict)
              const badgeLabel = fullyResolved
                ? 'CHOSEN'
                : kinds.length ? `${kinds.join(' + ')} OVERLAP` : 'OVERLAP'

              const mainDisplayName   = conflict.mainTrack.display_name   ?? conflict.mainTrack.name
              const branchDisplayName = conflict.branchTrack.display_name ?? conflict.branchTrack.name

              return (
                <div key={conflict.trackName}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`size-1.5 shrink-0 ${fullyResolved ? 'bg-lime' : 'bg-destructive'}`} />
                    <span className="text-sm font-medium text-foreground">{trackTitle(conflict.branchTrack)}</span>
                    <span className={`text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 ml-auto border ${
                      fullyResolved
                        ? 'border-lime/40 text-lime bg-lime-soft'
                        : 'border-destructive/40 text-destructive bg-destructive/10'
                    }`}>
                      {fullyResolved ? 'CHOSEN' : badgeLabel}
                    </span>
                  </div>

                  {conflict.fileConflict && (
                    <div className="flex gap-3">
                      <FileConflictCard label="MASTER" track={conflict.mainTrack}
                        chosen={res.fileChoice === 'main'} onChoose={() => setFileChoice(conflict.trackName, 'main')} />
                      <FileConflictCard label="VERSION" track={conflict.branchTrack}
                        chosen={res.fileChoice === 'branch'} onChoose={() => setFileChoice(conflict.trackName, 'branch')} />
                    </div>
                  )}

                  {conflict.renameConflict && (
                    <>
                      {conflict.fileConflict && (
                        <>
                          <div className="h-px bg-border my-3" />
                          <p className="text-xs text-muted-foreground m-0 mb-2">This track was also renamed:</p>
                        </>
                      )}
                      {!conflict.fileConflict && (
                        <p className="text-xs text-muted-foreground m-0 mb-3">Choose a name for this track:</p>
                      )}
                      <RenameConflictPills
                        mainName={mainDisplayName} branchName={branchDisplayName}
                        chosen={res.nameChoice} onChoose={c => setNameChoice(conflict.trackName, c)}
                      />
                    </>
                  )}

                  {conflict.offsetConflict && (
                    <>
                      {(conflict.fileConflict || conflict.renameConflict) && (
                        <>
                          <div className="h-px bg-border my-3" />
                          <p className="text-xs text-muted-foreground m-0 mb-2">This track was also moved on the timeline:</p>
                        </>
                      )}
                      {!conflict.fileConflict && !conflict.renameConflict && (
                        <p className="text-xs text-muted-foreground m-0 mb-3">Choose where this track starts on the timeline:</p>
                      )}
                      <OffsetConflictPills
                        mainStartBar={conflict.mainTrack.start_bar}
                        branchStartBar={conflict.branchTrack.start_bar}
                        chosen={res.offsetChoice}
                        onChoose={c => setOffsetChoice(conflict.trackName, c)}
                      />
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {sectionConflicts.length > 0 && (
          <div className="flex flex-col gap-3">
            <SectionLabel>Structure</SectionLabel>
            {sectionConflicts.map((conflict) => {
              const key = rangeKey(conflict)
              const chosen = sectionResolutions[key]
              const resolved = !!chosen
              return (
                <div key={key}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`size-1.5 shrink-0 ${resolved ? 'bg-lime' : 'bg-destructive'}`} />
                    <span className="text-sm font-medium text-foreground font-mono tabular-nums">
                      Bars {conflict.startBar + 1}–{conflict.endBar}
                    </span>
                    <span className={`text-[9px] font-bold tracking-widest uppercase px-2 py-0.5 ml-auto border ${
                      resolved ? 'border-lime/40 text-lime bg-lime-soft' : 'border-destructive/40 text-destructive bg-destructive/10'
                    }`}>
                      {resolved ? 'CHOSEN' : 'STRUCTURE OVERLAP'}
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <SectionStatePill label="MASTER" state={conflict.mainState}
                      chosen={chosen === 'main'} onChoose={() => setSectionChoice(key, 'main')} />
                    <SectionStatePill label="VERSION" state={conflict.branchState}
                      chosen={chosen === 'branch'} onChoose={() => setSectionChoice(key, 'branch')} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {sectionAutoItems.length > 0 && (
          <div>
            <div className="mb-2"><SectionLabel>Structure (auto)</SectionLabel></div>
            <MergeListBox>
              {sectionAutoItems.map((item, i) => (
                <MergeListRow key={i} last={i === sectionAutoItems.length - 1}>
                  <AutoCheckIcon />
                  <span className="text-xs text-foreground font-mono tabular-nums">Bars {item.startBar + 1}–{item.endBar}</span>
                  <span className="text-[11px] text-muted-foreground">→</span>
                  <SectionTag state={item.branchState} />
                  <span className="text-[9px] uppercase tracking-widest text-muted-foreground ml-auto border border-border px-2 py-0.5">Auto</span>
                </MergeListRow>
              ))}
            </MergeListBox>
          </div>
        )}

        {preview.commentChanges && (
          <CommentChangesSection
            commentChanges={preview.commentChanges}
            commentDeletionChoice={commentDeletionChoice}
            onDeletionChoiceChange={setCommentDeletionChoice}
            showAddedDetail={showAddedDetail}
            onToggleAddedDetail={() => setShowAddedDetail(v => !v)}
            showDeletedDetail={showDeletedDetail}
            onToggleDeletedDetail={() => setShowDeletedDetail(v => !v)}
          />
        )}

        {preview.autoMerge.length > 0 && (
          <MergeListBox>
            {preview.autoMerge.map((item, i) => (
              <MergeListRow key={i} last={i === preview.autoMerge.length - 1}>
                <AutoCheckIcon />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-foreground">{trackTitle(item.track)}</span>
                  {item.action === 'apply_rename' && (
                    <p className="text-[11px] mt-0.5 m-0 text-muted-foreground">
                      Display name: &ldquo;{trackTitle(item.track)}&rdquo; → &ldquo;{item.newDisplayName}&rdquo;
                    </p>
                  )}
                  {item.action === 'apply_offset' && (
                    <p className="text-[11px] mt-0.5 m-0 text-muted-foreground font-mono">
                      Timeline: {formatTrackStartBar(item.previousStartBar ?? 0)} → {formatTrackStartBar(item.newStartBar ?? 0)}
                    </p>
                  )}
                </div>
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground shrink-0 border border-border px-2 py-0.5">
                  {autoMergeBadge(item)}
                </span>
              </MergeListRow>
            ))}
          </MergeListBox>
        )}
        </>
        )}
      </div>

      <div className="px-5 py-4 shrink-0 flex items-center justify-between gap-3 border-t border-border">
        {mergeErr ? <p className="text-xs text-destructive m-0">{mergeErr}</p> : <div />}
        <div className="flex gap-2">
          <MergeBtn onClick={onClose}>Cancel</MergeBtn>
          <MergeBtn variant="primary" disabled={!canMerge || merging} onClick={handleMerge}>
            {merging
              ? 'Applying…'
              : unresolvedCount > 0
                ? `Apply (${unresolvedCount} left)`
                : 'Apply →'}
          </MergeBtn>
        </div>
      </div>
    </MergeShell>
  )
}
