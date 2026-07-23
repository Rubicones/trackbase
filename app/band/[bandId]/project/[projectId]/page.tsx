'use client'

import React, { useEffect, useRef, useState, useCallback, useMemo, Fragment } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import type { TrackComment, Track, Version, Project, Section } from '@/lib/types'
import { useVersionCache } from '@/hooks/useVersionCache'
import { useAuth } from '@/contexts/AuthContext'
import { usePaywallGate } from '@/contexts/PaywallContext'
import { PaywallLockWrap, paywallLockedButtonClass } from '@/components/paywall/PaywallLock'
import { trackEvent } from '@/lib/analytics'
import {
  buildOnboardingDisplayVersions,
  isOnboardingDemoId,
  isOnboardingDemoActive,
  seedOnboardingDemoWaveforms,
  clearOnboardingDemoWaveforms,
} from '@/lib/onboardingDemo'
import { allTracksLoaded } from '@/lib/transportStatus'
import { barOffsetToMs } from '@/lib/commentTimecodes'
import { ProjectTour, TourHelpButton } from '@/components/onboarding/ProjectTour'
import {
  COMPARE_TOUR_STEPS,
  buildStructureTourSteps,
  featureTourCompletedKey,
  featureTourSkippedKey,
  isFeatureTourPending,
  type FeatureTourId,
} from '@/components/onboarding/featureTourSteps'
import CompareMode from '@/components/CompareMode'
import { CherryPickDiff } from '@/components/merge/CherryPickDiff'
import { MergeModal } from './MergeModal'
import StructureOverlay, { getBarMath } from '@/components/StructureEditor'
import { ProjectMetaFields } from '@/components/ProjectMetaFields'
import { AppHeader, StatusFooter } from '@/components/design/AppShell'
import { ResourceErrorScreen } from '@/components/design/ResourceErrorScreen'
import { RoadmapPreview } from '@/components/RoadmapPreview'
import { SongRoadmap, useProjectRoadmap } from '@/components/SongRoadmap'
import { SongChecklist, type ChecklistItem, type ChecklistMember } from '@/components/SongChecklist'
import { Toast, type ToastVariant } from '@/components/design/Toast'
import { TactGrid } from '@/components/design/TactGrid'
import { HoverTooltip } from '@/components/design/HoverTooltip'
import { waveformBarsCache, audioArrayBufferCache } from '@/lib/waveformCache'
import { MobileExperience } from '@/components/MobileExperience'
import { MobileMixerVersionBar } from '@/components/MobileMixerVersionBar'
import { getTrackIconSwatches, trackAccentColor, needsTrackIconColor, pickTrackIconColor } from '@/lib/trackIcon'
import { Skeleton } from '@/components/ui/Skeleton'
import { BAND_STORAGE_LIMIT_BYTES, storageQuotaError } from '@/lib/bandStorage'
import { fetchBandData } from '@/lib/bandDataCache'
import {
  fetchProjectChecklistJson,
  fetchProjectJson,
  fetchProjectStorageJson,
  fetchVersionSectionsJson,
} from '@/lib/projectDataCache'
import { ChatDock } from '@/components/chat/ChatDock'
import { useChatPanel } from '@/components/chat/useChatPanel'
import { startCountdown } from '@/lib/metronomeAudio'
import { buildSectionRanges, findSectionRangeAtTime } from '@/lib/sectionPlayback'
import { getSharedAudioContext, getMasterOutput } from '@/lib/audioContext'
import { acquireMicStream } from '@/lib/micCapture'
import { prefetchPreviewMixPlayback } from '@/lib/previewMixClient'
import { RecordingTrackRow, type RecordingTrackControl, type RecordState } from '@/components/RecordingTrackRow'
import { ChevronsLeftRightEllipsis, Trash2 } from 'lucide-react'
import { getVersionDisplayName } from '@/lib/versionSort'
import { VersionToolbarDropdown } from '@/components/VersionToolbarDropdown'
import { MasterEditConfirmModal } from '@/components/MasterEditConfirmModal'
import {
  MasterEditGuardCancelled,
  isMasterEditGuardSuppressed,
  suppressMasterEditGuard24h,
} from '@/lib/masterEditGuard'
import {
  TrackEditArea,
  TrackEditConfirmModal,
  TrackEditShortcutsModal,
} from '@/components/TrackEditArea'
import {
  type TrackEditSession,
  type EditSelection,
  createEditSession,
  sessionCommit,
  sessionUndo,
  sessionRedo,
  sessionIsDirty,
  splitAtBar,
  removeSelection,
  duplicateSelection,
  pasteAt,
  moveSegment,
  setSegmentStartEdge,
  setSegmentEndEdge,
  selectionClips,
  clipsLenBars,
  editStatePreviewPieces,
  editStateToPayload,
  editStateEndBar,
  contentBarsFor,
} from '@/lib/trackEdit'

// ── Extracted mixer modules (behavior-preserving refactor) ────────────────────
import { usePlayer } from './usePlayer'
import { TrackRow } from './TrackRow'
import { UploadRow } from './UploadRow'
import { MasterPlayerBar } from './MasterPlayerBar'
import { Sidebar } from './Sidebar'
import { NewBranchModal, DeleteVersionModal } from './modals'
import { MobilePortraitSkeleton, TrackRowSkeleton } from './skeletons'
import { CommentToggleBtn } from './commentLayer'
import { MixerToolbarGroup, MixerToolbarSeparator, TbBtn } from './mixerChrome'
import {
  MAX_PROJECT_BARS,
  RECORDING_EXTEND_CHUNK_BARS,
  RECORDING_EXTEND_LEAD_BARS,
  TRACK_LABEL_W,
  TRACK_ROW_H,
  fmtTime,
  trackContentDurationMs,
  uploadToR2Direct,
} from './mixerUtils'
import type { ActiveCommentInput, UploadItem } from './mixerTypes'
// ─── Audio caches ─────────────────────────────────────────────────────────────
// Imported from @/lib/waveformCache (shared with StructureEditor).

// ─── Upload helpers ───────────────────────────────────────────────────────────

const MAX_CONCURRENT_UPLOADS = 3
// Max times we retry the project fetch after a cold-load 401 before surfacing an error.
const MAX_AUTH_RETRIES = 2

// Style for bottom sheet action buttons (short landscape topbar overflow)
const sheetBtnStyle: import('react').CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10,
  width: '100%', padding: '11px 20px', background: 'none', border: 'none',
  textAlign: 'left', cursor: 'pointer', fontSize: 14,
  color: 'var(--text-sec)',
}
// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectPage() {
  const { bandId, projectId } = useParams<{ bandId: string; projectId: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const cache = useVersionCache()
  const { user, profile, loading: authLoading, updateOnboarding } = useAuth()
  const { resolvedTheme, setTheme } = useTheme()
  const { open: chatOpen, openChat, closeChat } = useChatPanel()
  const [chatUnread, setChatUnread] = useState(0)

  const [project, setProject] = useState<Project | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [activeVersionId, setActiveVersionId] = useState('')
  const activeVersionIdRef = useRef('')
  activeVersionIdRef.current = activeVersionId
  const versionDeepLinkApplied = useRef(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<'not_found' | 'access_denied' | 'unknown' | null>(null)
  // Bumped on a cold-load 401 (fetch beat the client cookie sync) to drive a bounded
  // retry once auth resolves — mirrors the band page. See the retry effect below.
  const [authRetry, setAuthRetry] = useState(0)
  const [showBranchModal, setShowBranchModal] = useState(false)
  const [masterEditModal, setMasterEditModal] = useState<{
    pending: () => void | Promise<void>
    onDismiss?: () => void
  } | null>(null)
  const [uploading, setUploading] = useState(false)  // for handleReplaceTrack only
  const [replacingTrackId, setReplacingTrackId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mobileReplaceInputRef = useRef<HTMLInputElement>(null)
  const replaceTrackRef = useRef<Track | null>(null)
  const [commentMode, setCommentMode] = useState(false)
  const [resourceFilterTrackId, setResourceFilterTrackId] = useState<string | null>(null)
  const [activeCommentInput, setActiveCommentInput] = useState<ActiveCommentInput | null>(null)
  const [versionLoading, setVersionLoading] = useState(false)
  const [versionContentLoading, setVersionContentLoading] = useState(false)
  const versionSwitchLockedRef = useRef(false)

  // ── Non-destructive track edit session (desktop mixer) ──────────────────────
  const [editSession, setEditSession] = useState<TrackEditSession | null>(null)
  const [editApplyStatus, setEditApplyStatus] = useState<'idle' | 'processing' | 'error'>('idle')
  const [editApplyError, setEditApplyError] = useState<string | null>(null)
  const [editConfirm, setEditConfirm] = useState<null | {
    title: string
    body: string
    cancelLabel: string
    confirmLabel: string
    danger?: boolean
    action: () => void
  }>(null)
  const editSessionRef = useRef<TrackEditSession | null>(null)
  editSessionRef.current = editSession
  const editApplyStatusRef = useRef(editApplyStatus)
  editApplyStatusRef.current = editApplyStatus
  /** Display name of the track being edited — for confirm dialog copy (set during render below). */
  const editingTrackNameRef = useRef('')

  /** Reset edit state + confirm dialog; the preview-sync effect clears the player preview. */
  const discardEditSession = useCallback(() => {
    setEditSession(null)
    setEditApplyStatus('idle')
    setEditApplyError(null)
    setEditConfirm(null)
  }, [])

  const [mergeModal, setMergeModal] = useState<{ branchId: string } | null>(null)
  // Cherry-pick diff view — full-screen mode entered from the apply modal
  const [cherryPickDiff, setCherryPickDiff] = useState<{ branchId: string; targetVersionId: string } | null>(null)
  const cherryPickDiffRef = useRef(false)
  cherryPickDiffRef.current = cherryPickDiff !== null
  const [deleteVersionModal, setDeleteVersionModal] = useState<{ id: string; name: string } | null>(null)
  const [deletingVersion, setDeletingVersion] = useState(false)
  const [toast, setToast] = useState<{ message: string; variant?: ToastVariant } | null>(null)
  const [storageUsed, setStorageUsed] = useState(0)
  const [storageLimit, setStorageLimit] = useState(BAND_STORAGE_LIMIT_BYTES)
  const storageFull = storageUsed >= storageLimit
  const [shareCopied, setShareCopied] = useState(false)
  const [sections, setSections] = useState<Section[]>([])
  const [editStructure, setEditStructure] = useState(false)
  const [showTour, setShowTour] = useState(false)
  const [featureTour, setFeatureTour] = useState<FeatureTourId | null>(null)
  const [structureNaming, setStructureNaming] = useState(false)
  const structureNamingRef = useRef(false)
  structureNamingRef.current = structureNaming
  const [structureSectionOpen, setStructureSectionOpen] = useState(false)
  const structureSectionOpenRef = useRef(false)
  structureSectionOpenRef.current = structureSectionOpen
  /** Frozen when the structure tour starts — existing vs empty strip. */
  const [structureTourHadSections, setStructureTourHadSections] = useState(false)
  const [trackEditShortcutsOpen, setTrackEditShortcutsOpen] = useState(false)
  const [showMobileTour, setShowMobileTour] = useState(false)

  // ── Compare mode ──────────────────────────────────────────────────────────
  // Test-mode paywall — gates the A/B Compare entry button only
  const { locked: abCompareLocked, onLockedClick: onAbCompareLockedClick } = usePaywallGate('ab_compare')
  const [compareActive, setCompareActive] = useState(false)
  const [compareVersionBId, setCompareVersionBId] = useState<string>('')
  // Portal slot for compare transport bar (same DOM position as MasterPlayerBar)
  const [compareTransportSlot, setCompareTransportSlot] = useState<HTMLDivElement | null>(null)
  const compareActiveRef = useRef(false)
  compareActiveRef.current = compareActive

  // ── Roadmap + checklist ──────────────────────────────────────────────────────
  const [planOpen, setPlanOpen] = useState(false)
  // Roadmap/checklist UI is desktop-only (Plan panel). Skip the fetches on mobile.
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [checklistMembers, setChecklistMembers] = useState<ChecklistMember[]>([])
  const [waveformBounds, setWaveformBounds] = useState<{ left: number; right: number } | null>(null)
  // Responsive sidebar (collapsed by default on tablet/mobile)
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  )
  // Portrait detection — drives ReadingMode vs mixer (pure dimension check, no touch gate)
  const [isMobilePortrait, setIsMobilePortrait] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth < 768 && window.innerHeight > window.innerWidth
  })
  // Short landscape: landscape + height < 420px + not a full desktop window
  const [isShortLandscape, setIsShortLandscape] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth > window.innerHeight && window.innerHeight < 420 && window.innerWidth < 1024
  })
  const [isMobileLandscape, setIsMobileLandscape] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth > window.innerHeight && window.innerWidth < 1024
  })
  const isDesktopMixer = !isMobilePortrait && !isMobileLandscape

  const { roadmap, setRoadmap } = useProjectRoadmap(isDesktopMixer ? projectId : null)

  // Structure editing is desktop-only — keep mobile mixer light
  useEffect(() => {
    if (isMobileLandscape && editStructure) setEditStructure(false)
  }, [isMobileLandscape, editStructure])

  // Start streaming the cached preview mix as early as possible in rehearsal.
  useEffect(() => {
    if (!isMobilePortrait || !projectId) return
    prefetchPreviewMixPlayback(projectId)
  }, [isMobilePortrait, projectId])

  const [topbarSheetOpen, setTopbarSheetOpen] = useState(false)
  const trackListRef = useRef<HTMLDivElement>(null)
  const tracksBodyRef = useRef<HTMLDivElement>(null)
  const [recordingSessions, setRecordingSessions] = useState<{ id: string; name: string }[]>([])
  const [activeRecordingId, setActiveRecordingId] = useState<string | null>(null)
  const [recordingPreviewEnds, setRecordingPreviewEnds] = useState<Record<string, number>>({})
  // Extra bars added during a live recording so the ruler doesn't stop at the
  // default 16-bar ceiling. Reset when the recording session ends.
  const [recordingExtraBars, setRecordingExtraBars] = useState(0)
  // Drag-and-drop state
  const [isDragging, setIsDragging] = useState(false)
  const [isDraggingAddRow, setIsDraggingAddRow] = useState(false)
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const uploadsRef = useRef<UploadItem[]>([])
  // Track being dragged (for dimming others)
  const [decodedDurationMs, setDecodedDurationMs] = useState<Map<string, number>>(() => new Map())
  const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null)

  // ── Project rename ─────────────────────────────────────────────────────────
  const [projectNameEditing, setProjectNameEditing] = useState(false)
  const [projectNameValue, setProjectNameValue] = useState('')
  const [projectNameFlash, setProjectNameFlash] = useState(false)
  const projectNameInputRef = useRef<HTMLInputElement>(null)

  function startProjectRename() {
    if (!project) return
    setProjectNameValue(project.name)
    setProjectNameEditing(true)
    setTimeout(() => { projectNameInputRef.current?.select() }, 0)
  }

  // ── Roadmap + checklist handlers ─────────────────────────────────────────────
  function handleRoadmapChange(next: typeof roadmap) {
    setRoadmap(next)
  }

  async function handleChecklistAdd(text: string, assigneeId: string | null) {
    const res = await fetch(`/api/projects/${projectId}/checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, assignee_id: assigneeId }),
    })
    if (res.ok) {
      const { item } = await res.json()
      setChecklist(prev => [...prev, item])
      trackEvent('checklist_item_added')
    }
  }

  async function handleChecklistToggle(id: string) {
    const item = checklist.find(i => i.id === id)
    if (!item) return
    const newDone = !item.done
    setChecklist(prev => prev.map(i => i.id === id ? { ...i, done: newDone, done_at: newDone ? new Date().toISOString() : null } : i))
    await fetch(`/api/projects/${projectId}/checklist/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: newDone }),
    }).catch(() => {})
    if (newDone) trackEvent('checklist_item_completed')
  }

  async function handleChecklistUpdate(id: string, text: string) {
    setChecklist(prev => prev.map(i => i.id === id ? { ...i, text } : i))
    await fetch(`/api/projects/${projectId}/checklist/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(() => {})
  }

  async function handleChecklistDelete(id: string) {
    setChecklist(prev => prev.filter(i => i.id !== id))
    await fetch(`/api/projects/${projectId}/checklist/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  async function handleChecklistAssign(id: string, assigneeId: string | null) {
    setChecklist(prev => prev.map(i => i.id === id ? { ...i, assignee_id: assigneeId } : i))
    await fetch(`/api/projects/${projectId}/checklist/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignee_id: assigneeId }),
    }).catch(() => {})
  }

  async function commitProjectRename() {
    if (!project) return
    const trimmed = projectNameValue.trim()
    setProjectNameEditing(false)
    if (!trimmed || trimmed === project.name) return
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (res.ok) {
        const { project: updated } = await res.json()
        setProject(updated)
        setProjectNameFlash(true)
        setTimeout(() => setProjectNameFlash(false), 400)
      }
    } catch { /* ignore */ }
  }

  async function loadProject(keepActiveVersion = true, force = false) {
    // Set true when a 401 schedules an auth-ready retry, so `finally` keeps the
    // skeleton up instead of flashing an error screen (see the retry effect below).
    let retrying = false
    try {
      // Cache hit: if the active version is already cached, skip the full re-fetch
      if (!force && keepActiveVersion && activeVersionIdRef.current && cache.getVersion(activeVersionIdRef.current)) {
        return
      }

      let data: {
        project: Project
        versions: Version[]
      }
      try {
        data = await fetchProjectJson<{ project: Project; versions: Version[] }>(projectId)
      } catch (err) {
        const status = (err as { status?: number }).status
        const body = ((err as { body?: { code?: string } }).body ?? {}) as { code?: string }
        if (status === 401) {
          // Cold-load race: our fetch beat the client cookie sync. Retry once auth
          // resolves rather than surfacing a spurious error.
          setAuthRetry(n => n + 1)
          retrying = true
          return
        }
        if (status === 403 || body?.code === 'ACCESS_DENIED') {
          setError('access_denied')
        } else if (status === 404 || body?.code === 'NOT_FOUND') {
          setError('not_found')
        } else {
          setError('unknown')
        }
        return
      }
      setProject(data.project)
      setVersions(data.versions)

      // Populate cache for all fetched versions
      for (const v of data.versions) {
        const comments: Record<string, TrackComment[]> = {}
        for (const t of v.tracks) {
          comments[t.id] = t.comments ?? []
        }
        cache.setVersion(v.id, { tracks: v.tracks, comments, fetchedAt: Date.now() })
      }

      const main = data.versions.find(v => v.type === 'main')
      const fallbackId = main?.id ?? data.versions[0]?.id ?? ''
      const selectedId = activeVersionIdRef.current

      if (!keepActiveVersion) {
        // Explicit reset (e.g. project change, post-merge).
        setActiveVersionId(fallbackId)
      } else if (!selectedId) {
        // First load with no selection yet.
        setActiveVersionId(fallbackId)
      } else if (!data.versions.some(v => v.id === selectedId)) {
        // Previously selected version was deleted.
        setActiveVersionId(fallbackId)
      }
      // else: keep the user's current branch selection

      void fetchProjectStorageJson(projectId)
        .then(d => {
          setStorageUsed(d.used_bytes ?? 0)
          setStorageLimit(d.limit_bytes ?? BAND_STORAGE_LIMIT_BYTES)
        })
        .catch(() => {})
    } catch {
      setError('unknown')
    } finally {
      if (!retrying) setLoading(false)
    }
  }

  useEffect(() => { loadProject(false) }, [projectId]) // eslint-disable-line

  // Self-heal the cold-load 401 race once auth resolves with a signed-in user
  // (cookies now set). Bounded so a persistent 401 surfaces an error instead of
  // looping. No-op on the happy path (authRetry stays 0).
  useEffect(() => {
    if (authRetry === 0 || !loading) return
    if (authLoading || !user) return
    if (authRetry > MAX_AUTH_RETRIES) {
      setError('unknown')
      setLoading(false)
      return
    }
    loadProject(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authRetry, authLoading, user, loading])

  useEffect(() => {
    versionDeepLinkApplied.current = false
  }, [projectId])

  const performSelectVersion = useCallback((id: string) => {
    if (id === activeVersionIdRef.current) return
    if (versionSwitchLockedRef.current) return
    trackEvent('version_switched')
    setActiveVersionId(id)
    setCommentMode(false)
    setActiveCommentInput(null)
    setResourceFilterTrackId(null)
    if (searchParams.has('v') || searchParams.has('t') || searchParams.has('s') || searchParams.has('e')) {
      const params = new URLSearchParams(searchParams.toString())
      params.delete('v')
      params.delete('t')
      params.delete('s')
      params.delete('e')
      const qs = params.toString()
      router.replace(`/band/${bandId}/project/${projectId}${qs ? `?${qs}` : ''}`, { scroll: false })
    }
  }, [bandId, projectId, router, searchParams])

  const selectVersion = useCallback((id: string) => {
    if (id === activeVersionIdRef.current) return
    // An active edit session must be applied or discarded before switching versions.
    if (editSessionRef.current) {
      setEditConfirm({
        title: 'Unsaved track edits',
        body: `Discard all changes to “${editingTrackNameRef.current}”? Switching versions ends the edit session.`,
        cancelLabel: 'Keep editing',
        confirmLabel: 'Discard changes',
        danger: true,
        action: () => {
          discardEditSession()
          performSelectVersion(id)
        },
      })
      return
    }
    performSelectVersion(id)
  }, [performSelectVersion, discardEditSession])

  const navigateResourceVersion = useCallback((versionId: string) => {
    selectVersion(versionId)
    if (window.innerWidth < 1024) setSidebarOpen(false)
  }, [selectVersion])

  const navigateResourceTrack = useCallback((trackId: string, versionId: string) => {
    if (versionSwitchLockedRef.current && versionId !== activeVersionIdRef.current) return
    if (editSessionRef.current && versionId !== activeVersionIdRef.current) return
    setActiveVersionId(versionId)
    setCommentMode(false)
    setActiveCommentInput(null)
    setResourceFilterTrackId(trackId)
    requestAnimationFrame(() => {
      document.querySelector(`[data-track-row="${trackId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }, [])

  // Deep link from chat context chips: ?v=<versionId> — apply once on load only.
  useEffect(() => {
    if (versionDeepLinkApplied.current || versions.length === 0) return
    versionDeepLinkApplied.current = true
    const v = searchParams.get('v')
    if (v && versions.some(ver => ver.id === v)) {
      setActiveVersionId(v)
    }
  }, [versions, searchParams])

  // Checklist + assignee list — desktop Plan panel only (ChatDock loads band separately).
  useEffect(() => {
    if (!isDesktopMixer || !projectId) return
    void fetchProjectChecklistJson<{ items?: ChecklistItem[] }>(projectId)
      .then(d => { if (d) setChecklist(d.items ?? []) })
      .catch(() => {})
    void fetchBandData(bandId)
      .then(d => {
        const members = (d.members as {
          user_id: string
          profiles?: { username?: string; display_name?: string | null } | null
        }[] | undefined) ?? []
        setChecklistMembers(
          members.map(m => ({
            user_id: m.user_id,
            username: m.profiles?.username ?? m.user_id,
            display_name: m.profiles?.display_name ?? null,
          })),
        )
      })
      .catch(() => {})
  }, [isDesktopMixer, projectId, bandId]) // eslint-disable-line

  // Sync stage from project once loaded — roadmap loads via useProjectRoadmap

  // Auto-start tour for first-time visitors — desktop mixer only
  useEffect(() => {
    if (!isDesktopMixer) return
    if (!loading && profile && !profile.onboarding?.project_tour_completed && !profile.onboarding?.project_tour_skipped) {
      const t = setTimeout(() => setShowTour(true), 400)
      return () => clearTimeout(t)
    }
  }, [loading, profile, isDesktopMixer])

  // Auto-start mobile tour — portrait rehearsal → mixer flow
  useEffect(() => {
    if (!isMobilePortrait) return
    if (!loading && profile && !profile.onboarding?.mobile_project_tour_completed && !profile.onboarding?.mobile_project_tour_skipped) {
      const t = setTimeout(() => setShowMobileTour(true), 600)
      return () => clearTimeout(t)
    }
  }, [loading, profile, isMobilePortrait])

  const mainTourOpen = showTour || showMobileTour
  const structureTourSteps = useMemo(
    () => buildStructureTourSteps({
      hasExistingSections: structureTourHadSections,
      hasDragEnded: () => structureNamingRef.current || sections.length > 0,
      hasSection: () => sections.length > 0,
      hasSectionOpen: () => structureSectionOpenRef.current,
    }),
    [structureTourHadSections, sections.length],
  )

  function finishFeatureTour(id: FeatureTourId, skipped: boolean) {
    setFeatureTour(null)
    if (id === 'structure') {
      setStructureSectionOpen(false)
      setStructureTourHadSections(false)
    }
    void updateOnboarding(skipped ? featureTourSkippedKey(id) : featureTourCompletedKey(id), true)
    trackEvent(skipped ? 'feature_tour_skipped' : 'feature_tour_completed', { tour: id })
  }

  // Compare tour — first time the user opens Compare (already open; no splash / open step)
  useEffect(() => {
    if (!isDesktopMixer || !compareActive || !profile || mainTourOpen || featureTour) return
    if (!isFeatureTourPending(profile.onboarding, 'compare')) return
    setFeatureTour('compare')
  }, [isDesktopMixer, compareActive, profile, mainTourOpen, featureTour])

  // Structure tour — first time Edit structure is on
  useEffect(() => {
    if (!isDesktopMixer || !editStructure || !profile || mainTourOpen || featureTour) return
    if (!isFeatureTourPending(profile.onboarding, 'structure')) return
    setStructureTourHadSections(sections.length > 0)
    setStructureSectionOpen(false)
    setFeatureTour('structure')
  }, [isDesktopMixer, editStructure, profile, mainTourOpen, featureTour, sections.length])

  // Track edit — shortcuts modal instead of a spotlight tour
  useEffect(() => {
    if (!isDesktopMixer || !editSession || !profile || mainTourOpen || featureTour) return
    if (!isFeatureTourPending(profile.onboarding, 'track_edit')) return
    setTrackEditShortcutsOpen(true)
  }, [isDesktopMixer, editSession, profile, mainTourOpen, featureTour])

  useEffect(() => {
    if (!editSession) setTrackEditShortcutsOpen(false)
  }, [editSession])

  // Leaving a feature mid-tour marks it skipped so Finish/skip persist correctly
  useEffect(() => {
    if (featureTour === 'compare' && !compareActive) finishFeatureTour('compare', true)
  }, [featureTour, compareActive])
  useEffect(() => {
    if (featureTour === 'structure' && !editStructure) {
      setStructureNaming(false)
      finishFeatureTour('structure', true)
    }
  }, [featureTour, editStructure])

  // On version switch: serve from cache if available, otherwise fetch fresh data.
  async function loadVersionData(versionId: string) {
    if (!versionId) return
    if (cache.getVersion(versionId)) return
    // Cache miss — full project refresh to get this version's tracks + comments
    setVersionLoading(true)
    try { await loadProject() }
    finally { setVersionLoading(false) }
  }

  useEffect(() => {
    if (activeVersionId) loadVersionData(activeVersionId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVersionId])

  useEffect(() => {
    if (!activeVersionId) {
      setVersionContentLoading(false)
      setSections([])
      return
    }
    let cancelled = false
    setVersionContentLoading(true)
    setSections([])
    void fetchVersionSectionsJson<{ sections?: Section[] }>(activeVersionId)
      .then(d => {
        if (cancelled) return
        setSections(d.sections ?? [])
      })
      .catch(() => {
        if (cancelled) return
        setSections([])
      })
      .finally(() => {
        if (cancelled) return
        setVersionContentLoading(false)
      })
    return () => { cancelled = true }
  }, [activeVersionId])

  const versionSwitchLocked = loading || versionContentLoading
  versionSwitchLockedRef.current = versionSwitchLocked

  const onboardingDemoActive = isOnboardingDemoActive(profile?.onboarding, {
    showDesktopTour: showTour,
    showMobileTour: showMobileTour,
  })

  const displayVersions = useMemo(
    () => buildOnboardingDisplayVersions(versions, projectId, onboardingDemoActive),
    [versions, projectId, onboardingDemoActive],
  )

  function exitOnboardingTourView() {
    clearOnboardingDemoWaveforms(displayVersions)
    const main = versions.find(v => v.type === 'main')
    if (main && (isOnboardingDemoId(activeVersionId) || !versions.some(v => v.id === activeVersionId))) {
      setActiveVersionId(main.id)
    }
    setResourceFilterTrackId(null)
    setCommentMode(false)
    setActiveCommentInput(null)
  }

  useEffect(() => {
    seedOnboardingDemoWaveforms(displayVersions)
    return () => clearOnboardingDemoWaveforms(displayVersions)
  }, [displayVersions])

  const activeVersion = displayVersions.find(v => v.id === activeVersionId)
    ?? versions.find(v => v.id === activeVersionId)
  const activeTracks = activeVersion?.tracks ?? []
  useEffect(() => {
    if (versions.length === 0) return
    if (isOnboardingDemoId(activeVersionId) && !displayVersions.some(v => v.id === activeVersionId)) {
      const main = versions.find(v => v.type === 'main')
      if (main) setActiveVersionId(main.id)
    }
  }, [displayVersions, activeVersionId, versions])

  const resourceFilterTrackName = useMemo(() => {
    if (!resourceFilterTrackId) return null
    const track = activeTracks.find(t => t.id === resourceFilterTrackId)
    return track ? (track.display_name ?? track.name) : null
  }, [resourceFilterTrackId, activeTracks])
  const midiTracksNeedingDataKey = useMemo(
    () => activeTracks
      .filter(t => t.file_type === 'midi' && !t.midi_data)
      .map(t => t.id)
      .sort()
      .join('|'),
    [activeTracks],
  )
  useEffect(() => {
    if (!midiTracksNeedingDataKey) return
    let cancelled = false
    for (const id of midiTracksNeedingDataKey.split('|')) {
      fetch(`/api/tracks/${id}/midi`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (cancelled || !data?.midi_data) return
          handleMidiDataUpdate(id, { midi_data: data.midi_data })
        })
        .catch(() => {})
    }
    return () => { cancelled = true }
  }, [midiTracksNeedingDataKey])
  const canSaveVersion = activeVersion?.type === 'branch' && !activeVersion.merged_at
  const isOnMainVersion = activeVersion?.type === 'main'

  const guardMasterEdit = useCallback((
    pending: () => void | Promise<void>,
    onDismiss?: () => void,
  ) => {
    if (!isOnMainVersion || isMasterEditGuardSuppressed()) {
      void pending()
      return
    }
    setMasterEditModal({ pending, onDismiss })
  }, [isOnMainVersion])

  // Assign vivid palette colors — backfill legacy defaults and dedupe batch-upload collisions.
  const backfillingColorsRef = useRef(false)
  const trackColorKey = activeTracks.map(t => `${t.id}:${t.icon_color ?? ''}`).join('|')
  useEffect(() => {
    if (!activeVersionId || !activeTracks.length || backfillingColorsRef.current) return

    const used = new Set<string>()
    const assignments: { id: string; color: string }[] = []

    const swatchCount = getTrackIconSwatches().length

    activeTracks.forEach((t, i) => {
      if (isOnboardingDemoId(t.id)) return
      let color = t.icon_color
      // Only treat a repeated color as a collision while the palette still has
      // spare swatches — once every swatch is in use, repeats are expected
      // (pickTrackIconColor itself rotates through the palette by index past
      // that point), so reassigning here would just churn a track's color
      // every time the track list changes shape, e.g. on file replace.
      const isCollision = used.has(color ?? '') && used.size < swatchCount
      if (!color || needsTrackIconColor(color) || isCollision) {
        color = pickTrackIconColor(Array.from(used), i)
      }
      used.add(color)
      if (color !== t.icon_color) assignments.push({ id: t.id, color })
    })

    if (!assignments.length) return

    backfillingColorsRef.current = true
    let cancelled = false

    ;(async () => {
      try {
        const results = await Promise.allSettled(assignments.map(({ id, color }) =>
          fetch(`/api/tracks/${id}/icon`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ icon_color: color }),
          }).then(res => {
            if (!res.ok) throw new Error(`icon ${res.status}`)
          }),
        ))
        if (cancelled) return
        const byId = new Map<string, string>()
        assignments.forEach((a, i) => {
          if (results[i].status === 'fulfilled') byId.set(a.id, a.color)
        })
        if (byId.size === 0) return
        setVersions(prev => prev.map(v =>
          v.id !== activeVersionId ? v : {
            ...v,
            tracks: v.tracks.map(t => (
              byId.has(t.id) ? { ...t, icon_color: byId.get(t.id)! } : t
            )),
          },
        ))
      } catch {
        /* display fallbacks until next load */
      } finally {
        backfillingColorsRef.current = false
      }
    })()

    return () => { cancelled = true }
  }, [activeVersionId, trackColorKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Measure waveform column bounds for structure overlay alignment.
  // Uses [data-waveform-col] from an actual track row.
  useEffect(() => {
    if (isMobilePortrait) return
    const listEl = trackListRef.current
    if (!listEl) return
    function measure() {
      if (!listEl) return
      const wfEl = listEl.querySelector('[data-waveform-col]') as HTMLElement | null
      const rowEl = wfEl?.closest('[data-track-row]') as HTMLElement | null
      if (!wfEl || !rowEl) return
      const rowRect = rowEl.getBoundingClientRect()
      const wfRect = wfEl.getBoundingClientRect()
      setWaveformBounds({
        left: wfRect.left - rowRect.left,
        right: rowRect.right - wfRect.right,
      })
    }
    measure()
    const obs = new ResizeObserver(measure)
    obs.observe(listEl)
    return () => obs.disconnect()
  }, [activeTracks.length, recordingSessions.length, isMobilePortrait, compareActive])

  // Orientation detection — switches between ReadingMode and mixer, collapses topbar on short landscape
  useEffect(() => {
    if (typeof window === 'undefined') return
    function check() {
      const w = window.innerWidth, h = window.innerHeight
      setIsMobilePortrait(w < 768 && h > w)
      setIsShortLandscape(w > h && h < 420 && w < 1024)
      setIsMobileLandscape(w > h && w < 1024)
    }
    window.addEventListener('resize', check)
    window.addEventListener('orientationchange', check)
    return () => {
      window.removeEventListener('resize', check)
      window.removeEventListener('orientationchange', check)
    }
  }, [])

  const mainVersion = versions.find(v => v.type === 'main')
  const mainHashes = new Set((mainVersion?.tracks ?? []).map(t => t.file_hash))
  const isChanged = (t: Track) => !!mainVersion && activeVersionId !== mainVersion.id && !mainHashes.has(t.file_hash)

  const recordingPreviewEndSec = Math.max(0, ...Object.values(recordingPreviewEnds))

  const projBpm = project?.bpm ?? 120
  const projTimeSig = project?.time_signature ?? '4/4'
  const projBeatsPerBar = parseInt(projTimeSig.split('/')[0]) || 4
  const projBarDurationMs = (60000 / projBpm) * projBeatsPerBar
  const minTimelineBars = 16

  const baseProjectBars = (() => {
    if (activeTracks.length === 0) return minTimelineBars
    const barDurMs = projBarDurationMs || 2000
    const endBars = activeTracks.map(t => {
      const dMs = trackContentDurationMs(t, projBpm, decodedDurationMs.get(t.id))
      const bars = Math.ceil((dMs || 0) / barDurMs)
      return (t.start_bar ?? 0) + bars
    })
    // An active edit session can extend the timeline (segments moved/pasted
    // beyond the current project end) — same auto-extend as dragging a track.
    const editEndBars = editSession ? editStateEndBar(editSession.state) : 0
    return Math.max(...endBars, editEndBars, minTimelineBars)
  })()

  const totalProjectBars = Math.min(
    baseProjectBars + (activeRecordingId !== null ? recordingExtraBars : 0),
    MAX_PROJECT_BARS,
  )

  const timelineDurationSec = Math.max(
    (totalProjectBars * projBarDurationMs) / 1000,
    recordingPreviewEndSec,
    (minTimelineBars * projBarDurationMs) / 1000,
    1,
  )

  const player = usePlayer(
    activeTracks,
    activeVersionId,
    project,
    recordingPreviewEndSec,
    timelineDurationSec,
    {
      enabled: isMobilePortrait,
      projectId,
      isMainVersion: activeVersion?.type === 'main',
    },
  )
  const playerRef = useRef(player)
  playerRef.current = player

  // ── Track edit session — handlers ────────────────────────────────────────────
  const editBarDurSec = projBarDurationMs / 1000
  const editBarDurSecRef = useRef(editBarDurSec)
  editBarDurSecRef.current = editBarDurSec

  const editingTrack = editSession
    ? activeTracks.find(t => t.id === editSession.trackId) ?? null
    : null
  const editingTrackName = editingTrack
    ? (editingTrack.display_name ?? editingTrack.name)
    : ''
  editingTrackNameRef.current = editingTrackName
  const editDirty = editSession != null && sessionIsDirty(editSession)

  // End the session if its track disappears (e.g. deleted from another tab).
  useEffect(() => {
    if (editSession && editingTrack === null && !loading && !versionContentLoading) {
      discardEditSession()
    }
  }, [editSession, editingTrack, loading, versionContentLoading, discardEditSession])

  // Keep the player's live preview in sync with the uncommitted edit state so
  // playback always sounds like the rendered result would.
  useEffect(() => {
    if (!editSession) {
      playerRef.current.setEditPreview(null)
      return
    }
    const durMs = decodedDurationMs.get(editSession.trackId)
      ?? playerRef.current.trackDurations.get(editSession.trackId)
      ?? activeTracks.find(t => t.id === editSession.trackId)?.duration_ms
      ?? 0
    playerRef.current.setEditPreview({
      trackId: editSession.trackId,
      pieces: editStatePreviewPieces(editSession.state, editBarDurSec, durMs / 1000),
    })
    // activeTracks/decodedDurationMs are lookups only — session state drives resync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSession, editBarDurSec])

  // Warn before leaving the page with unsaved edit changes.
  useEffect(() => {
    if (!editDirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [editDirty])

  // Intercept in-app link navigation (e.g. back to band) while edits are unsaved.
  useEffect(() => {
    if (!editDirty) return
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      if (!href.startsWith('/') || href.startsWith('/api/')) return
      e.preventDefault()
      e.stopPropagation()
      setEditConfirm({
        title: 'Unsaved track edits',
        body: `Discard all changes to “${editingTrackNameRef.current}”?`,
        cancelLabel: 'Keep editing',
        confirmLabel: 'Discard & leave',
        danger: true,
        action: () => {
          discardEditSession()
          router.push(href)
        },
      })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [editDirty, discardEditSession, router])

  function beginEditSession(track: Track) {
    const durMs = decodedDurationMs.get(track.id)
      ?? playerRef.current.trackDurations.get(track.id)
      ?? track.duration_ms
      ?? 0
    if (durMs <= 0 || editBarDurSec <= 0) return
    setEditApplyStatus('idle')
    setEditApplyError(null)
    setEditSession(createEditSession(
      track.id,
      track.start_bar ?? 0,
      contentBarsFor(durMs / 1000, editBarDurSec),
    ))
    trackEvent('track_edit_started')
  }

  function handleRequestEdit(track: Track) {
    if (editApplyStatusRef.current === 'processing') return
    const current = editSessionRef.current
    if (current?.trackId === track.id) return
    if (current) {
      // Only one track can be in edit mode — confirm before switching.
      setEditConfirm({
        title: 'Switch tracks?',
        body: `You're editing “${editingTrackNameRef.current}”. Discard those changes and edit “${track.display_name ?? track.name}” instead?`,
        cancelLabel: 'Keep editing',
        confirmLabel: 'Discard & edit',
        danger: true,
        action: () => {
          discardEditSession()
          guardMasterEdit(() => beginEditSession(track))
        },
      })
      return
    }
    guardMasterEdit(() => beginEditSession(track))
  }

  // Bar-snapped playhead placement from the edit area.
  function handleEditSeekBar(bar: number) {
    playerRef.current.seek(bar * editBarDurSecRef.current)
  }

  function handleEditSelect(sel: EditSelection | null) {
    setEditSession(prev => (prev ? { ...prev, selection: sel } : prev))
  }

  function handleEditSeparate(playheadBar: number) {
    const prev = editSessionRef.current
    if (!prev) return
    const next = splitAtBar(prev.state, playheadBar)
    if (!next) return
    setEditSession(sessionCommit(prev, next, prev.selection))
    trackEvent('track_edit_op', { op: 'separate' })
  }

  function handleEditRemove() {
    const prev = editSessionRef.current
    if (!prev?.selection) return
    const next = removeSelection(prev.state, prev.selection)
    if (!next) return
    setEditSession(sessionCommit(prev, next, null))
    trackEvent('track_edit_op', { op: 'remove' })
  }

  function handleEditDuplicate() {
    const prev = editSessionRef.current
    if (!prev?.selection) return
    const res = duplicateSelection(prev.state, prev.selection)
    if (!res) return
    setEditSession(sessionCommit(prev, res.state, res.selection))
    trackEvent('track_edit_op', { op: 'duplicate' })
  }

  function handleEditCopy() {
    const prev = editSessionRef.current
    if (!prev?.selection) return
    const clips = selectionClips(prev.state, prev.selection)
    if (!clips || clipsLenBars(clips) === 0) return
    setEditSession({
      ...prev,
      clipboard: { clips, lenBars: prev.selection.endBar - prev.selection.startBar },
    })
  }

  function handleEditPaste(playheadBar: number) {
    const prev = editSessionRef.current
    if (!prev?.clipboard) return
    const res = pasteAt(prev.state, playheadBar, prev.clipboard)
    if (!res) return
    setEditSession(sessionCommit(prev, res.state, null))
    // Playhead moves to the end of the pasted content.
    playerRef.current.seek(res.endBar * editBarDurSecRef.current)
    trackEvent('track_edit_op', { op: 'paste' })
  }

  function handleEditMoveSegment(segId: string, newStartBar: number) {
    const prev = editSessionRef.current
    if (!prev) return
    setEditSession(sessionCommit(prev, moveSegment(prev.state, segId, newStartBar), prev.selection))
  }

  function handleEditTrimSegmentStart(segId: string, newStartBar: number) {
    const prev = editSessionRef.current
    if (!prev) return
    const next = setSegmentStartEdge(prev.state, segId, newStartBar, prev.contentBars)
    if (!next) return
    setEditSession(sessionCommit(prev, next, null))
    trackEvent('track_edit_op', { op: 'trim_start' })
  }

  function handleEditTrimSegmentEnd(segId: string, newEndBar: number) {
    const prev = editSessionRef.current
    if (!prev) return
    const next = setSegmentEndEdge(prev.state, segId, newEndBar, prev.contentBars)
    if (!next) return
    setEditSession(sessionCommit(prev, next, null))
    trackEvent('track_edit_op', { op: 'trim_end' })
  }

  function handleEditUndo() {
    setEditSession(prev => (prev ? sessionUndo(prev) : prev))
  }

  function handleEditRedo() {
    setEditSession(prev => (prev ? sessionRedo(prev) : prev))
  }

  async function performEditApply() {
    const session = editSessionRef.current
    if (!session) return
    setEditApplyStatus('processing')
    setEditApplyError(null)
    try {
      const res = await fetch(`/api/tracks/${session.trackId}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editStateToPayload(session.state)),
      })
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))).error ?? 'Processing failed'
        throw new Error(msg)
      }
      // The track row now points at the rendered file — drop every stale cache
      // and reload both metadata and audio.
      waveformBarsCache.delete(session.trackId)
      audioArrayBufferCache.delete(session.trackId)
      discardEditSession()
      trackEvent('track_edit_applied')
      cache.invalidate(activeVersionId)
      await Promise.all([
        playerRef.current.reloadTrack(session.trackId),
        loadProject(true, true),
      ])
    } catch (err) {
      // Keep the session alive so the user's work isn't lost; allow retry.
      setEditApplyStatus('error')
      setEditApplyError(err instanceof Error ? err.message : 'Apply failed')
    }
  }

  function requestEditApply() {
    if (!editSessionRef.current || editApplyStatusRef.current === 'processing') return
    setEditConfirm({
      title: 'Apply changes?',
      body: `Apply changes to “${editingTrackNameRef.current}”? This will replace the current track with the edited version.`,
      cancelLabel: 'Keep editing',
      confirmLabel: 'Apply changes',
      action: () => {
        setEditConfirm(null)
        void performEditApply()
      },
    })
  }

  function requestEditCancel() {
    if (!editSessionRef.current || editApplyStatusRef.current === 'processing') return
    setEditConfirm({
      title: 'Discard changes?',
      body: `Discard all changes to “${editingTrackNameRef.current}”?`,
      cancelLabel: 'Keep editing',
      confirmLabel: 'Discard changes',
      danger: true,
      action: () => discardEditSession(),
    })
  }

  const [activeLoopSectionId, setActiveLoopSectionId] = useState<string | null>(null)
  const sectionRanges = useMemo(() => buildSectionRanges(sections), [sections])
  const projBarDurationSec = projBarDurationMs / 1000
  const playheadSec = player.currentTimeRef.current ?? player.currentTime
  const canLoopSection = findSectionRangeAtTime(sectionRanges, playheadSec, projBarDurationSec) != null
  const sectionLoopButtonEnabled = player.sectionLoopOn || canLoopSection

  const handleToggleSectionLoop = useCallback(() => {
    const p = playerRef.current
    if (p.sectionLoopOn) {
      p.clearSectionLoop()
      setActiveLoopSectionId(null)
      trackEvent('loop_toggled', { enabled: false })
      return
    }
    const range = findSectionRangeAtTime(
      sectionRanges,
      p.currentTimeRef.current,
      projBarDurationSec,
    )
    if (!range) return
    p.setSectionLoop({ id: range.id, startBar: range.start_bar, endBar: range.end_bar })
    setActiveLoopSectionId(range.id)
    trackEvent('loop_toggled', { enabled: true })
  }, [sectionRanges, projBarDurationSec])

  useEffect(() => {
    if (!activeLoopSectionId) return
    const sec = sections.find(s => s.id === activeLoopSectionId)
    if (!sec) {
      playerRef.current.clearSectionLoop()
      setActiveLoopSectionId(null)
      return
    }
    playerRef.current.setSectionLoop({
      id: sec.id,
      startBar: sec.start_bar,
      endBar: sec.end_bar,
    })
  }, [sections, activeLoopSectionId])

  useEffect(() => {
    setActiveLoopSectionId(null)
    playerRef.current.clearSectionLoop()
  }, [activeVersionId])

  useEffect(() => {
    if (!player.sectionLoopOn) setActiveLoopSectionId(null)
  }, [player.sectionLoopOn])

  const activeRecordingIdRef = useRef(activeRecordingId)
  activeRecordingIdRef.current = activeRecordingId
  const recordingStopRef = useRef<(() => void) | null>(null)
  const recordingControlsRef = useRef<Map<string, RecordingTrackControl>>(new Map())
  const pendingMobileArmRef = useRef<string | null>(null)
  const pendingMicStreamsRef = useRef<Map<string, MediaStream>>(new Map())
  const [recordingRowStates, setRecordingRowStates] = useState<Record<string, RecordState>>({})
  const [scrollToRecordingId, setScrollToRecordingId] = useState<string | null>(null)

  const beginRecordingCountdown = useCallback(async (bpm: number, timeSig: string) => {
    const ctx = getSharedAudioContext()
    if (ctx.state === 'suspended') await ctx.resume()
    return startCountdown(ctx, getMasterOutput(), bpm, timeSig)
  }, [])

  // Read from currentTimeRef (updated synchronously on every seek/tick) rather
  // than playerRef.current.currentTime (the 5Hz React state).  During
  // seek-while-playing, seek() sets currentTimeRef immediately but does NOT
  // call setCurrentTime(), so the React state is stale until the next rAF
  // tick.  Without this fix, RecordingTrackRow's preview effect fires (due to
  // seekEpoch) but reads the old position and re-schedules the source inside
  // the recording's range even when the user has seeked past it.
  const getRecordingPlaybackMs = useCallback(
    () => (playerRef.current.currentTimeRef.current ?? 0) * 1000,
    [],
  )

  useEffect(() => {
    for (const stream of pendingMicStreamsRef.current.values()) {
      stream.getTracks().forEach(t => t.stop())
    }
    pendingMicStreamsRef.current.clear()
    pendingMobileArmRef.current = null
    setRecordingSessions([])
    setActiveRecordingId(null)
    setRecordingPreviewEnds({})
  }, [activeVersionId])

  const addRecordingInFlightRef = useRef(false)

  // Mic must be requested in this click (user activation). Auto-arming from a
  // child useEffect loses the gesture and browsers often never show a prompt —
  // the row sticks on "Requesting mic…". Same pattern as the mobile Rec button.
  async function handleAddRecordingTrack() {
    if (storageFull) {
      setToast({ message: storageQuotaError(storageUsed, storageLimit), variant: 'error' })
      setTimeout(() => setToast(null), 4000)
      return
    }
    if (!activeVersionId || addRecordingInFlightRef.current) return
    trackEvent('record_track_clicked')
    addRecordingInFlightRef.current = true
    const id = crypto.randomUUID()
    try {
      const stream = await acquireMicStream()
      pendingMicStreamsRef.current.set(id, stream)
      pendingMobileArmRef.current = id
      setScrollToRecordingId(id)
      setRecordingSessions(prev => [...prev, { id, name: 'New recording' }])
    } catch {
      pendingMicStreamsRef.current.delete(id)
      if (pendingMobileArmRef.current === id) pendingMobileArmRef.current = null
      setToast({ message: 'Microphone access denied', variant: 'error' })
      setTimeout(() => setToast(null), 4000)
    } finally {
      addRecordingInFlightRef.current = false
    }
  }

  const registerRecordingControl = useCallback((id: string, control: RecordingTrackControl | null) => {
    if (control) {
      recordingControlsRef.current.set(id, control)
      if (pendingMobileArmRef.current === id) {
        pendingMobileArmRef.current = null
        const stream = pendingMicStreamsRef.current.get(id)
        if (stream) pendingMicStreamsRef.current.delete(id)
        void control.arm(stream)
      }
    } else {
      recordingControlsRef.current.delete(id)
    }
  }, [])

  const handleRecordingStateChange = useCallback((id: string, state: RecordState) => {
    setRecordingRowStates(prev => {
      if (prev[id] === state) return prev
      if (state === 'recording' && prev[id] !== 'recording') {
        trackEvent('recording_started')
      }
      return { ...prev, [id]: state }
    })
  }, [])

  const handleMobileRecordTransport = useCallback(async () => {
    if (recordingStopRef.current) {
      recordingStopRef.current()
      return
    }

    const targetId = activeRecordingId ?? recordingSessions[recordingSessions.length - 1]?.id

    if (!targetId) {
      const id = crypto.randomUUID()
      try {
        const stream = await acquireMicStream()
        pendingMicStreamsRef.current.set(id, stream)
        pendingMobileArmRef.current = id
        setScrollToRecordingId(id)
        setRecordingSessions(prev => [...prev, { id, name: 'New recording' }])
      } catch {
        // Mic denied — no session created
      }
      return
    }

    setScrollToRecordingId(targetId)

    const control = recordingControlsRef.current.get(targetId)
    if (!control) {
      pendingMobileArmRef.current = targetId
      return
    }

    const state = control.getState()
    if (state === 'idle') {
      try {
        const stream = await acquireMicStream()
        await control.arm(stream)
      } catch {
        // Mic denied
      }
    } else if (state === 'armed') {
      void control.startRecord()
    }
  }, [activeRecordingId, recordingSessions])

  function handleRecordingArm(id: string) {
    setActiveRecordingId(id)
  }

  function handleRecordingRelease(id: string) {
    setActiveRecordingId(prev => (prev === id ? null : prev))
  }

  async function handleRecordingSaved(id: string, track: Track) {
    trackEvent('recording_saved', { duration_ms: track.duration_ms ?? 0 })
    setRecordingSessions(prev => prev.filter(s => s.id !== id))
    setActiveRecordingId(prev => (prev === id ? null : prev))
    setVersions(prev => prev.map(v =>
      v.id === activeVersionId ? { ...v, tracks: [...v.tracks, track] } : v
    ))
    cache.invalidate(activeVersionId)
    await loadProject()
  }

  function handleRecordingDelete(id: string) {
    trackEvent('recording_discarded')
    const orphan = pendingMicStreamsRef.current.get(id)
    if (orphan) {
      orphan.getTracks().forEach(t => t.stop())
      pendingMicStreamsRef.current.delete(id)
    }
    if (pendingMobileArmRef.current === id) pendingMobileArmRef.current = null
    setRecordingSessions(prev => prev.filter(s => s.id !== id))
    setActiveRecordingId(prev => (prev === id ? null : prev))
    setRecordingPreviewEnds(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function handleRecordingPreviewTimeline(id: string, endSec: number | null) {
    setRecordingPreviewEnds(prev => {
      if (endSec != null && endSec > 0) {
        if (prev[id] === endSec) return prev
        return { ...prev, [id]: endSec }
      }
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  function handleRecordingNameChange(id: string, name: string) {
    setRecordingSessions(prev => prev.map(s => s.id === id ? { ...s, name } : s))
  }

  // Spacebar toggles play/pause (skip when typing in inputs or compare mode is active)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space') return
      // Compare mode registers its own spacebar handler; let it handle when active
      if (compareActiveRef.current) return
      if (cherryPickDiffRef.current) return
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return

      e.preventDefault()

      if (recordingStopRef.current) {
        recordingStopRef.current()
        return
      }

      const p = playerRef.current
      if (p.total > 0 && p.loaded < p.total) return

      const canPlay = p.duration > 0 || p.total > 0
      if (!canPlay) return

      if (p.playing || p.isCounting) p.pause()
      else p.play()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!commentMode) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (showBranchModal || masterEditModal || mergeModal || showTour || showMobileTour) return
      const el = e.target as HTMLElement
      if (el.closest('[role="dialog"]')) return
      setCommentMode(false)
      setActiveCommentInput(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commentMode, showBranchModal, masterEditModal, mergeModal, showTour, showMobileTour])

  const durationMs = player.duration * 1000
  // Total bars: max(start_bar + durationBars) across ALL tracks.
  // Duration uses project BPM for all track types (including MIDI).
  function effectiveTrackDurationMs(t: Track): number {
    return trackContentDurationMs(
      t,
      projBpm,
      decodedDurationMs.get(t.id) ?? player.trackDurations.get(t.id),
    )
  }
  const totalProjectDurationMs = Math.max(totalProjectBars * projBarDurationMs, durationMs, 1)

  function handleTrackDuration(trackId: string, ms: number) {
    playerRef.current.noteTrackDuration(trackId, ms)
    setDecodedDurationMs(prev => {
      if (prev.get(trackId) === ms) return prev
      const next = new Map(prev)
      next.set(trackId, ms)
      return next
    })
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => {
        if (t.id !== trackId) return t
        if (t.duration_ms != null && t.duration_ms >= ms) return t
        return { ...t, duration_ms: ms }
      }),
    })))
  }

  // ── Auto-extend ruler during live recording ────────────────────────────────
  // When an empty project is being recorded into, totalProjectBars starts at 16.
  // As the playhead approaches the end, we add 16 bars at a time so the ruler,
  // transport, and metronome all keep going until recording stops (max 1000 bars).
  useEffect(() => {
    if (activeRecordingId === null) {
      setRecordingExtraBars(0)
      return
    }
    if (projBarDurationMs <= 0) return

    const barDurSec = projBarDurationMs / 1000
    const currentBar = playerRef.current.currentTimeRef.current / barDurSec
    const maxExtraBars = Math.max(0, MAX_PROJECT_BARS - baseProjectBars)

    setRecordingExtraBars(extra => {
      const currentTotal = Math.min(baseProjectBars + extra, MAX_PROJECT_BARS)
      if (currentBar < currentTotal - RECORDING_EXTEND_LEAD_BARS) return extra
      if (extra >= maxExtraBars) return extra
      return Math.min(extra + RECORDING_EXTEND_CHUNK_BARS, maxExtraBars)
    })
  }, [player.currentTime, activeRecordingId, baseProjectBars, projBarDurationMs])

  useEffect(() => {
    setDecodedDurationMs(new Map())
  }, [activeVersionId])

  useEffect(() => {
    if (player.trackDurations.size === 0) return
    setDecodedDurationMs(prev => {
      let changed = false
      const next = new Map(prev)
      for (const [id, ms] of player.trackDurations) {
        if (prev.get(id) !== ms) {
          next.set(id, ms)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [player.trackDurations])

  async function handleCommentCreate(trackId: string, startMs: number, endMs: number, content: string) {
    const track = activeTracks.find(t => t.id === trackId)
    let trackStartMs = startMs
    let trackEndMs = endMs
    if (track) {
      const offsetMs = barOffsetToMs(
        track.start_bar ?? 0,
        project?.bpm ?? 120,
        project?.time_signature ?? '4/4',
      )
      // Mobile mixer uses project-timeline ms; desktop waveform uses track-relative ms.
      if (offsetMs > 0 && startMs >= offsetMs) {
        trackStartMs = startMs - offsetMs
        trackEndMs = endMs - offsetMs
      }
    }

    const res = await fetch(`/api/tracks/${trackId}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, timecode_start_ms: trackStartMs, timecode_end_ms: trackEndMs }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error ?? 'Failed to save comment')
    }
    const { comment } = await res.json()
    trackEvent('comment_created')

    // Update versions state in-place
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => t.id === trackId ? { ...t, comments: [...(t.comments ?? []), comment] } : t)
    })))

    // Patch cache in-place — no re-fetch needed
    cache.patchComments(activeVersionId, trackId, cs => [...cs, comment])
  }

  async function handleCommentDelete(commentId: string) {
    await fetch(`/api/comments/${commentId}`, { method: 'DELETE' })
    trackEvent('comment_deleted')

    // Find which track the comment belonged to (for cache patching)
    let ownerTrackId = ''
    for (const v of versions) {
      for (const t of v.tracks) {
        if ((t.comments ?? []).some(c => c.id === commentId)) {
          ownerTrackId = t.id
          break
        }
      }
      if (ownerTrackId) break
    }

    // Update versions state in-place
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => ({ ...t, comments: (t.comments ?? []).filter(c => c.id !== commentId) }))
    })))

    // Patch cache in-place
    if (ownerTrackId) {
      cache.patchComments(activeVersionId, ownerTrackId, cs => cs.filter(c => c.id !== commentId))
    }
  }

  async function handleDeleteTrack(trackId: string) {
    const res = await fetch(`/api/tracks/${trackId}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error ?? 'Delete failed')
    }
    trackEvent('track_deleted')
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.filter(t => t.id !== trackId),
    })))
    cache.invalidate(activeVersionId)
  }

  function handleColorUpdate(trackId: string, color: string) {
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => t.id === trackId ? { ...t, icon_color: color } : t),
    })))
  }

  function handleRenameTrack(trackId: string, newName: string) {
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => t.id === trackId ? { ...t, display_name: newName } : t),
    })))
    cache.invalidate(activeVersionId)
  }

  function handleMidiDataUpdate(trackId: string, updates: Partial<Track>) {
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => t.id === trackId ? { ...t, ...updates } : t),
    })))
    cache.invalidate(activeVersionId)
  }

  // Per-track debounce timers and abort controllers for start_bar PATCH requests.
  const startBarDebounceRef = useRef<Map<string, { timer: ReturnType<typeof setTimeout>, reject: () => void }>>(new Map())
  const startBarAbortRef = useRef<Map<string, AbortController>>(new Map())

  async function handleStartBarUpdate(trackId: string, startBar: number) {
    const originalStartBar = activeTracks.find(t => t.id === trackId)?.start_bar ?? 0

    // Optimistic update — reflect the new position immediately before the request lands.
    const updatedTracks = activeTracks.map(t => t.id === trackId
      ? { ...t, start_bar: startBar, midi_start_bar: startBar }
      : t)
    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => t.id === trackId
        ? { ...t, start_bar: startBar, midi_start_bar: startBar }
        : t),
    })))
    cache.invalidate(activeVersionId)
    if (player.playing) player.seek(player.currentTime, updatedTracks)

    // Cancel any pending debounced PATCH for this track (superseded by this call).
    const existing = startBarDebounceRef.current.get(trackId)
    if (existing) {
      clearTimeout(existing.timer)
      existing.reject()
      startBarDebounceRef.current.delete(trackId)
    }
    // Abort any in-flight PATCH for this track.
    startBarAbortRef.current.get(trackId)?.abort()
    startBarAbortRef.current.delete(trackId)

    // Debounce: wait 1s before sending the PATCH. A newer call will reject this promise.
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          startBarDebounceRef.current.delete(trackId)
          resolve()
        }, 1000)
        startBarDebounceRef.current.set(trackId, { timer, reject })
      })
    } catch {
      // Superseded by a newer drag — bail without reverting (newer call owns the state).
      return
    }

    const abort = new AbortController()
    startBarAbortRef.current.set(trackId, abort)
    try {
      const res = await fetch(`/api/tracks/${trackId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_bar: startBar }),
        signal: abort.signal,
      })
      startBarAbortRef.current.delete(trackId)

      if (!res.ok) {
        // Revert to original position on failure.
        const revertedTracks = activeTracks.map(t => t.id === trackId
          ? { ...t, start_bar: originalStartBar, midi_start_bar: originalStartBar }
          : t)
        setVersions(prev => prev.map(v => ({
          ...v,
          tracks: v.tracks.map(t => t.id === trackId
            ? { ...t, start_bar: originalStartBar, midi_start_bar: originalStartBar }
            : t),
        })))
        cache.invalidate(activeVersionId)
        if (player.playing) player.seek(player.currentTime, revertedTracks)
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error ?? 'Failed to save track offset')
      }
      trackEvent('track_offset_changed')
    } catch (err) {
      startBarAbortRef.current.delete(trackId)
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Aborted by a newer call — no revert needed.
        return
      }
      throw err
    }
  }

  const requestStartBarUpdate = (trackId: string, startBar: number) => {
    return new Promise<void>((resolve, reject) => {
      guardMasterEdit(
        () => handleStartBarUpdate(trackId, startBar).then(resolve).catch(reject),
        () => reject(new MasterEditGuardCancelled()),
      )
    })
  }

  const requestDeleteTrack = (trackId: string) => {
    // Don't let a track be deleted mid-replace — the row is about to be
    // swapped out for the newly-processed track anyway.
    if (replacingTrackId === trackId) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      guardMasterEdit(
        () => handleDeleteTrack(trackId).then(resolve).catch(reject),
        () => reject(new MasterEditGuardCancelled()),
      )
    })
  }

  // ── Upload state helpers ────────────────────────────────────────────────────

  function mutUploads(fn: (prev: UploadItem[]) => UploadItem[]) {
    // Compute next from ref (synchronous), update ref immediately so subsequent
    // reads in the same tick see the latest value, then enqueue a React re-render.
    const next = fn(uploadsRef.current)
    uploadsRef.current = next
    setUploads(next)
  }

  function updateUpload(id: string, patch: Partial<UploadItem>) {
    mutUploads(prev => prev.map(u => u.id === id ? { ...u, ...patch } : u))
  }

  function removeUpload(id: string) {
    mutUploads(prev => prev.filter(u => u.id !== id))
  }

  // ── Core upload flow ────────────────────────────────────────────────────────

  async function uploadFile(upload: UploadItem) {
    if (!activeVersionId) return
    try {
      // Step 1: Get presigned URL
      updateUpload(upload.id, { status: 'presigning', error: undefined })

      const presignRes = await fetch(`/api/versions/${activeVersionId}/tracks/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: upload.file.name,
          fileSize: upload.file.size,
          contentType: upload.file.type || 'application/octet-stream',
        }),
      })
      if (!presignRes.ok) {
        const msg = (await presignRes.json().catch(() => ({}))).error ?? 'Failed to prepare upload'
        throw new Error(msg)
      }
      const { presignedUrl, tempKey } = await presignRes.json()

      // Step 2: Upload directly to R2
      updateUpload(upload.id, { status: 'uploading', tempKey, progress: 0 })

      await uploadToR2Direct(upload.file, presignedUrl, (percent) => {
        updateUpload(upload.id, { progress: percent })
      })

      // Step 3: Process on server (convert, hash, dedup, insert DB)
      updateUpload(upload.id, { status: 'processing', progress: 100 })

      const isMidi = upload.file.name.endsWith('.mid') || upload.file.name.endsWith('.midi')
      const processRes = await fetch(`/api/versions/${activeVersionId}/tracks/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tempKey,
          originalFilename: upload.file.name,
          fileSize: upload.file.size,
          mimetype: upload.file.type || 'application/octet-stream',
          ...(isMidi ? { midiStartBar: 0 } : {}),
        }),
      })
      if (!processRes.ok) {
        const msg = (await processRes.json().catch(() => ({}))).error ?? 'Processing failed'
        throw new Error(msg)
      }

      const { track: newTrack } = await processRes.json()
      if (newTrack) {
        setVersions(prev => prev.map(v =>
          v.id === activeVersionId
            ? { ...v, tracks: [...v.tracks.filter(t => t.id !== newTrack.id), newTrack] }
            : v,
        ))
      }

      updateUpload(upload.id, { status: 'done' })
      trackEvent('track_uploaded', { file_type: uploadFileType(upload.file) })
      cache.invalidate(activeVersionId)
      await loadProject(true, true)
      setTimeout(() => removeUpload(upload.id), 1500)

    } catch (err) {
      updateUpload(upload.id, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed',
      })
      trackEvent('track_upload_failed', { file_type: uploadFileType(upload.file) })
    } finally {
      // After this upload finishes/errors, start any queued uploads
      setTimeout(() => processUploadQueue(), 0)
    }
  }

  function processUploadQueue() {
    const current = uploadsRef.current
    const active = current.filter(u =>
      u.status === 'presigning' || u.status === 'uploading' || u.status === 'processing'
    )
    const pending = current.filter(u => u.status === 'pending')
    const slots = Math.max(0, MAX_CONCURRENT_UPLOADS - active.length)
    pending.slice(0, slots).forEach(u => uploadFile(u))
  }

  // ── Retry logic ─────────────────────────────────────────────────────────────

  async function retryProcessing(upload: UploadItem) {
    if (!activeVersionId || !upload.tempKey) return
    try {
      updateUpload(upload.id, { status: 'processing', progress: 100, error: undefined })
      const processRes = await fetch(`/api/versions/${activeVersionId}/tracks/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tempKey: upload.tempKey,
          originalFilename: upload.file.name,
          fileSize: upload.file.size,
          mimetype: upload.file.type || 'application/octet-stream',
        }),
      })
      if (!processRes.ok) {
        const msg = (await processRes.json().catch(() => ({}))).error ?? 'Processing failed'
        throw new Error(msg)
      }
      const { track: newTrack } = await processRes.json()
      if (newTrack) {
        setVersions(prev => prev.map(v =>
          v.id === activeVersionId
            ? { ...v, tracks: [...v.tracks.filter(t => t.id !== newTrack.id), newTrack] }
            : v,
        ))
      }
      updateUpload(upload.id, { status: 'done' })
      trackEvent('track_uploaded', { file_type: uploadFileType(upload.file) })
      cache.invalidate(activeVersionId)
      await loadProject(true, true)
      setTimeout(() => removeUpload(upload.id), 1500)
    } catch (err) {
      updateUpload(upload.id, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Processing failed',
      })
      trackEvent('track_upload_failed', { file_type: uploadFileType(upload.file) })
    }
  }

  function retryUpload(uploadId: string) {
    const upload = uploadsRef.current.find(u => u.id === uploadId)
    if (!upload) return
    trackEvent('track_upload_retried', { file_type: uploadFileType(upload.file) })

    if (upload.tempKey) {
      // R2 upload succeeded — only processing failed; skip re-upload
      retryProcessing(upload)
    } else {
      // Full retry from scratch
      const reset: UploadItem = { ...upload, status: 'pending', progress: 0, error: undefined }
      updateUpload(uploadId, { status: 'pending', progress: 0, error: undefined })
      const active = uploadsRef.current.filter(u =>
        u.status === 'presigning' || u.status === 'uploading' || u.status === 'processing'
      )
      if (active.length < MAX_CONCURRENT_UPLOADS) {
        uploadFile(reset)
      }
      // else processUploadQueue() will pick it up when a slot opens
    }
  }

  // ── Entry points ─────────────────────────────────────────────────────────────

  const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200 MB

function uploadFileType(file: File): 'audio' | 'midi' {
  return file.name.endsWith('.mid') || file.name.endsWith('.midi') ? 'midi' : 'audio'
}

  function handleUploadFiles(files: File[]) {
    if (!files.length || !activeVersionId) return
    if (storageFull) {
      setToast({ message: storageQuotaError(storageUsed, storageLimit), variant: 'error' })
      setTimeout(() => setToast(null), 4000)
      return
    }

    const newUploads: UploadItem[] = []
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        setToast({ message: `${file.name} is too large (max 200MB)`, variant: 'error' })
        setTimeout(() => setToast(null), 4000)
        continue
      }
      newUploads.push({ id: crypto.randomUUID(), file, status: 'pending', progress: 0 })
    }
    if (!newUploads.length) return

    mutUploads(prev => [...prev, ...newUploads])

    // Kick off up to MAX_CONCURRENT_UPLOADS immediately
    const active = uploadsRef.current.filter(u =>
      u.status === 'presigning' || u.status === 'uploading' || u.status === 'processing'
    )
    const slots = Math.max(0, MAX_CONCURRENT_UPLOADS - active.length)
    newUploads.slice(0, slots).forEach(u => uploadFile(u))
  }

  function handleAddTrack(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter(isAcceptedFile)
    e.target.value = ''
    if (files.length) handleUploadFiles(files)
  }

  // Drag-and-drop helpers
  function isAcceptedFileDrag(e: React.DragEvent) {
    return Array.from(e.dataTransfer.items).some(it =>
      it.kind === 'file' && (it.type.startsWith('audio/') || it.type === '')
    )
  }
  function isAcceptedFile(f: File) {
    return (
      f.type.startsWith('audio/') ||
      f.name.endsWith('.wav') || f.name.endsWith('.mp3') ||
      f.name.endsWith('.mid') || f.name.endsWith('.midi')
    )
  }
  function handleContentDragOver(e: React.DragEvent) {
    if (!isAcceptedFileDrag(e)) return
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy'
    setIsDragging(true)
  }
  function handleContentDragLeave(e: React.DragEvent) {
    if (e.relatedTarget && (e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return
    setIsDragging(false); setIsDraggingAddRow(false)
  }
  function handleContentDrop(e: React.DragEvent) {
    e.preventDefault(); setIsDragging(false); setIsDraggingAddRow(false)
    const files = Array.from(e.dataTransfer.files).filter(isAcceptedFile)
    if (!files.length) {
      setToast({ message: 'Only WAV, MP3, and MIDI files are supported', variant: 'error' })
      setTimeout(() => setToast(null), 3000)
      return
    }
    handleUploadFiles(files)
  }
  function handleAddRowDragOver(e: React.DragEvent) {
    if (!isAcceptedFileDrag(e)) return
    e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'
    setIsDraggingAddRow(true)
  }
  function handleAddRowDragLeave(e: React.DragEvent) {
    e.stopPropagation()
    if (e.relatedTarget && (e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return
    setIsDraggingAddRow(false)
  }
  function handleAddRowDrop(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation()
    setIsDragging(false); setIsDraggingAddRow(false)
    const files = Array.from(e.dataTransfer.files).filter(isAcceptedFile)
    if (files.length) handleUploadFiles(files)
  }

  async function handleReplaceTrack(track: Track, file: File) {
    // Don't let a second replace stack on top of one already in flight for
    // this track (e.g. a stray double-trigger from the mobile picker).
    if (replacingTrackId === track.id) return
    if (storageFull) {
      alert(storageQuotaError(storageUsed, storageLimit))
      return
    }
    if (!activeVersionId) return
    setUploading(true)
    setReplacingTrackId(track.id)
    try {
      const presignRes = await fetch(`/api/versions/${activeVersionId}/tracks/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          fileSize: file.size,
          contentType: file.type || 'application/octet-stream',
        }),
      })
      if (!presignRes.ok) {
        const msg = (await presignRes.json().catch(() => ({}))).error ?? 'Failed to prepare upload'
        throw new Error(msg)
      }
      const { presignedUrl, tempKey } = await presignRes.json()

      await uploadToR2Direct(file, presignedUrl, () => {})

      const isMidi = file.name.endsWith('.mid') || file.name.endsWith('.midi')
      const startBar = track.start_bar ?? track.midi_start_bar ?? 0
      const processRes = await fetch(`/api/versions/${activeVersionId}/tracks/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tempKey,
          originalFilename: file.name,
          fileSize: file.size,
          mimetype: file.type || 'application/octet-stream',
          name: track.name,
          position: track.position,
          iconColor: track.icon_color ?? undefined,
          ...(track.display_name ? { displayName: track.display_name } : {}),
          ...(isMidi ? { midiStartBar: startBar } : { startBar }),
        }),
      })
      if (!processRes.ok) {
        const msg = (await processRes.json().catch(() => ({}))).error ?? 'Processing failed'
        throw new Error(msg)
      }

      const delRes = await fetch(`/api/tracks/${track.id}`, { method: 'DELETE' })
      if (!delRes.ok) {
        throw new Error((await delRes.json().catch(() => ({}))).error ?? 'Failed to remove old track')
      }

      waveformBarsCache.delete(track.id)
      audioArrayBufferCache.delete(track.id)
      cache.invalidate(activeVersionId)
      trackEvent('track_replaced', { file_type: isMidi ? 'midi' : 'audio' })
      await loadProject(true, true)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Replace failed')
    } finally {
      setUploading(false)
      setReplacingTrackId(null)
    }
  }

  function promptReplaceTrack(track: Track) {
    // Already replacing this track — ignore the extra tap instead of
    // stacking a second concurrent upload for the same row.
    if (replacingTrackId === track.id) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      guardMasterEdit(
        () => {
          replaceTrackRef.current = track
          mobileReplaceInputRef.current?.click()
          resolve()
        },
        () => reject(new MasterEditGuardCancelled()),
      )
    })
  }

  function requestReplaceTrack(track: Track, file: File) {
    guardMasterEdit(() => { void handleReplaceTrack(track, file) })
  }

  function handleMobileReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const track = replaceTrackRef.current
    const file = e.target.files?.[0]
    e.target.value = ''
    replaceTrackRef.current = null
    if (track && file) void handleReplaceTrack(track, file)
  }

  async function handleNewBranch(name: string, tag: string | null) {
    setShowBranchModal(false)
    try {
      const res = await fetch(`/api/projects/${projectId}/versions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parent_id: activeVersionId, tag }),
      })
      const { version } = await res.json()
      trackEvent('version_created', { tag: tag || 'none' })
      cache.invalidate(activeVersionId)
      await loadProject()
      setActiveVersionId(version.id)
    } catch (err) { alert(err instanceof Error ? err.message : 'Failed') }
  }

  function handleMergeClick(branchId: string) {
    trackEvent('merge_initiated')
    setMergeModal({ branchId })
  }

  function handleOpenCherryPickDiff(branchId: string, targetVersionId: string) {
    trackEvent('cherry_pick_diff_opened')
    setMergeModal(null)
    if (playerRef.current.playing) playerRef.current.pause()
    setCherryPickDiff({ branchId, targetVersionId })
  }

  async function finishMergeApply(
    branchId: string | undefined,
    { tracksUpdated, branchName, targetName }: { tracksUpdated: number; branchName: string; targetName?: string },
  ) {
    trackEvent('version_saved')
    if (branchId) cache.invalidate(branchId)
    const target = versions.find(v => v.name === targetName) ?? versions.find(v => v.type === 'main')
    if (target) cache.invalidate(target.id)
    await loadProject(false)
    const main = versions.find(v => v.type === 'main')
    setActiveVersionId(main?.id ?? branchId ?? '')
    const intoLabel = targetName ?? 'Master'
    const msg = `"${branchName}" applied to ${intoLabel} — ${tracksUpdated} track${tracksUpdated !== 1 ? 's' : ''} updated`
    setToast({ message: msg, variant: 'success' })
    setTimeout(() => setToast(null), 3000)
  }

  async function handleMergeComplete(result: { tracksUpdated: number; branchName: string; targetName?: string }) {
    const branchId = mergeModal?.branchId
    setMergeModal(null)
    await finishMergeApply(branchId, result)
  }

  async function handleCherryPickApplied(result: { tracksUpdated: number; branchName: string; targetName?: string }) {
    const branchId = cherryPickDiff?.branchId
    setCherryPickDiff(null)
    await finishMergeApply(branchId, result)
  }

  async function handleRenameVersion(id: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    const version = versions.find(v => v.id === id)
    if (!version || version.type === 'main' || trimmed === version.name) return
    try {
      const res = await fetch(`/api/versions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (res.ok) {
        const { version: updated } = await res.json()
        setVersions(prev => prev.map(v => v.id === id ? { ...v, name: updated.name } : v))
        trackEvent('version_renamed')
      } else {
        const msg = (await res.json().catch(() => ({}))).error
        if (msg) alert(msg)
      }
    } catch { /* ignore */ }
  }

  function requestDeleteVersion(id: string) {
    const version = versions.find(v => v.id === id)
    if (!version || version.type === 'main') return
    setDeleteVersionModal({ id, name: getVersionDisplayName(version) })
  }

  async function handleDeleteVersionConfirm() {
    if (!deleteVersionModal) return
    const { id } = deleteVersionModal
    setDeletingVersion(true)
    try {
      const res = await fetch(`/api/versions/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))).error ?? 'Failed to delete version'
        throw new Error(msg)
      }
      cache.invalidate(id)
      const main = versions.find(v => v.type === 'main')
      setVersions(prev => prev.filter(v => v.id !== id))
      if (activeVersionIdRef.current === id && main) {
        setActiveVersionId(main.id)
        setCommentMode(false)
        setActiveCommentInput(null)
      }
      trackEvent('version_deleted')
      setDeleteVersionModal(null)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete version')
    } finally {
      setDeletingVersion(false)
    }
  }

  async function handleReplyCreate(commentId: string, content: string) {
    const res = await fetch(`/api/comments/${commentId}/replies`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
    if (!res.ok) throw new Error('Failed')
    const { reply } = await res.json()
    trackEvent('comment_reply_added')

    setVersions(prev => prev.map(v => ({
      ...v,
      tracks: v.tracks.map(t => ({
        ...t,
        comments: (t.comments ?? []).map(c =>
          c.id === commentId
            ? { ...c, replies: [...(c.replies ?? []), reply] }
            : c
        ),
      })),
    })))
  }

  const isOwner = false // project page doesn't fetch band membership; allow comment deletion by author only
  const currentUser = profile && profile.username ? { username: profile.username as string } : null

  const totalComments = activeTracks.reduce((n, t) => n + (t.comments?.length ?? 0), 0)
  const waveformsInteractive = useMemo(
    () => allTracksLoaded({
      tracksLoaded: player.loaded,
      tracksTotal: player.total,
      activeTracks,
      midiPlaybackReadyIds: player.midiPlaybackReadyIds,
    }),
    [player.loaded, player.total, activeTracks, player.midiPlaybackReadyIds],
  )

  const commentCounts: Record<string, number> = {}
  for (const v of versions) {
    commentCounts[v.id] = v.tracks.reduce((n, t) => n + (t.comments?.length ?? 0), 0)
  }

  async function handleShare() {
    trackEvent('share_clicked')
    const url = new URL(`/band/${bandId}/project/${projectId}`, window.location.origin)
    if (activeVersionId) url.searchParams.set('v', activeVersionId)
    await navigator.clipboard.writeText(url.toString())
    setShareCopied(true)
    setTimeout(() => setShareCopied(false), 2000)
  }

  const toggleCommentMode = useCallback(() => {
    setCommentMode(m => {
      const next = !m
      trackEvent('comment_mode_toggled', { enabled: next })
      return next
    })
    setActiveCommentInput(null)
  }, [])

  const toggleEditStructure = useCallback(() => {
    if (editStructure) {
      setEditStructure(false)
      return
    }
    guardMasterEdit(() => {
      trackEvent('structure_edit_opened')
      setEditStructure(true)
    })
  }, [editStructure, guardMasterEdit])

  const togglePlanOpen = useCallback(() => {
    setPlanOpen(o => {
      if (!o) trackEvent('roadmap_opened')
      return !o
    })
  }, [])

  const openAddTrackPicker = useCallback(() => {
    trackEvent('add_track_clicked')
    fileInputRef.current?.click()
  }, [])

  const headerActions = (
    <>
      {isMobileLandscape && (
        <CommentToggleBtn
          active={commentMode}
          count={totalComments}
          onClick={toggleCommentMode}
        />
      )}
      <TourHelpButton onClick={() => setShowTour(true)} />
    </>
  )

  if (!loading && (error || !project)) {
    const isAccessDenied = error === 'access_denied'
    const isNotFound = error === 'not_found' || !project

    return (
      <ResourceErrorScreen
        crumbs={<span className="text-muted-foreground">Project</span>}
        accessDenied={isAccessDenied}
        title={
          isAccessDenied
            ? "You don't have access to this project"
            : isNotFound
            ? 'Project not found'
            : 'Something went wrong'
        }
        description={
          isAccessDenied
            ? "This project belongs to a band you're not a member of. Ask a band member to invite you if you need access."
            : isNotFound
            ? "This project doesn't exist or may have been deleted."
            : 'We had trouble loading this project. Try refreshing the page.'
        }
        actions={[
          { label: 'Go to My Bands', href: '/dashboard', primary: true },
          ...(!isAccessDenied
            ? [{ label: 'Retry', onClick: () => window.location.reload() }]
            : []),
        ]}
      />
    )
  }

  return (
    <div className="project-page flex flex-col h-screen overflow-hidden bg-background">

      {/* Portrait mobile skeleton — CSS-class ensures it only shows on portrait mobile */}
      {!project && (
        <div className="skeleton-portrait-mobile"><MobilePortraitSkeleton /></div>
      )}

      {/* Portrait mobile — Rehearsal ⇄ Mixer tabs */}
      {isMobilePortrait && project && (
        <MobileExperience
          project={project}
          bandId={bandId}
          versions={displayVersions}
          activeVersionId={activeVersionId}
          onVersionChange={selectVersion}
          versionSwitchDisabled={versionSwitchLocked}
          player={{
            playing: player.playing,
            currentTime: player.currentTime,
            duration: player.duration,
            loaded: player.loaded,
            total: player.total,
            playbackReady: player.playbackReady,
            playbackMix: player.playbackMix,
            play: player.play,
            pause: player.pause,
            seek: player.seek,
            seekEpoch: player.seekEpoch,
            currentTimeRef: player.currentTimeRef,
          }}
          sections={sections}
          onSectionsChange={setSections}
          projectId={projectId}
          barDurationMs={projBarDurationMs}
          sectionLoopOn={player.sectionLoopOn}
          sectionLoopEnabled={sectionLoopButtonEnabled}
          onToggleSectionLoop={handleToggleSectionLoop}
          metronomeOn={player.metronomeOn}
          countdownOn={player.countdownOn}
          isCounting={player.isCounting}
          onToggleMetronome={player.toggleMetronome}
          onToggleCountdown={player.toggleCountdown}
          onNewBranch={() => setShowBranchModal(true)}
          commentMode={commentMode}
          commentCount={totalComments}
          onToggleCommentMode={toggleCommentMode}
          mixer={{
            project,
            versionId: activeVersionId,
            versions,
            activeVersionId,
            onVersionChange: selectVersion,
            versionSwitchDisabled: versionSwitchLocked,
            onNewBranch: () => setShowBranchModal(true),
            onRenameVersion: handleRenameVersion,
            onDeleteVersion: requestDeleteVersion,
            sections,
            onSectionsChange: setSections,
            sectionRanges,
            activeTracks,
            totalProjectBars,
            totalDurationMs: totalProjectDurationMs,
            barDurationMs: projBarDurationMs,
            player: {
              playing: player.playing,
              isCounting: player.isCounting,
              currentTime: player.currentTime,
              currentTimeRef: player.currentTimeRef,
              duration: player.duration,
              playbackReady: player.playbackReady,
              playbackMix: player.playbackMix,
              tracksLoaded: player.loaded,
              tracksTotal: player.total,
              play: player.play,
              pause: player.pause,
              seek: player.seek,
              seekEpoch: player.seekEpoch,
              sectionLoopOn: player.sectionLoopOn,
              sectionLoopEnabled: sectionLoopButtonEnabled,
              onToggleSectionLoop: handleToggleSectionLoop,
              metronomeOn: player.metronomeOn,
              countdownOn: player.countdownOn,
              onToggleMetronome: player.toggleMetronome,
              onToggleCountdown: player.toggleCountdown,
            },
            mutedTracks: player.mutedTracks,
            soloedTracks: player.soloedTracks,
            midiRenderingTracks: player.midiRenderingTracks,
            onToggleMute: player.toggleMute,
            onToggleSolo: player.toggleSolo,
            onAddTrack: openAddTrackPicker,
            onAddRecording: handleAddRecordingTrack,
            storageFull,
            onReplaceTrack: promptReplaceTrack,
            onDeleteTrack: requestDeleteTrack,
            replacingTrackId,
            onColorUpdate: handleColorUpdate,
            onRecordTransport: () => { void handleMobileRecordTransport() },
            recordingTransportState: (() => {
              const id = activeRecordingId ?? recordingSessions[recordingSessions.length - 1]?.id
              return id ? (recordingRowStates[id] ?? 'idle') : 'idle'
            })(),
            scrollToRecordingId,
            onRecordingScrollDone: () => setScrollToRecordingId(null),
            commentMode,
            onToggleCommentMode: toggleCommentMode,
            commentCount: totalComments,
            activeCommentInput,
            onCommentPlace: setActiveCommentInput,
            onCommentDelete: handleCommentDelete,
            onCommentCreate: handleCommentCreate,
            onCloseCommentInput: () => setActiveCommentInput(null),
            onReplyCreate: handleReplyCreate,
            currentUserId: user?.id,
            isOwner,
            currentUser,
            waveformsInteractive,
            recordingSlot: recordingSessions.map(session => (
              <RecordingTrackRow
                key={session.id}
                id={session.id}
                name={session.name}
                onNameChange={handleRecordingNameChange}
                versionId={activeVersionId}
                bpm={projBpm}
                timeSig={projTimeSig}
                totalBars={totalProjectBars}
                countdownEnabled={player.countdownOn}
                getPlaybackMs={getRecordingPlaybackMs}
                isPlaying={player.playing}
                seekEpoch={player.seekEpoch}
                isActiveRecording={activeRecordingId !== null && activeRecordingId !== session.id}
                onArm={handleRecordingArm}
                onRelease={handleRecordingRelease}
                onSaved={handleRecordingSaved}
                onDelete={handleRecordingDelete}
                onPlaybackStart={player.playTransport}
                onPlaybackStop={player.pause}
                onSeekTo={player.seek}
                onPreparePlayback={player.prepareTransport}
                onPreviewTimelineChange={handleRecordingPreviewTimeline}
                recordingStopRef={recordingStopRef}
                playCountdown={beginRecordingCountdown}
                registerControl={registerRecordingControl}
                onStateChange={handleRecordingStateChange}
                getPreviewOutput={player.getPreviewOutput}
                mobileScrollableTimeline
              />
            )),
          }}
          onOpenChat={openChat}
          chatUnread={chatUnread}
          showTour={showMobileTour}
          onTourFinish={() => {
            setShowMobileTour(false)
            exitOnboardingTourView()
            updateOnboarding('mobile_project_tour_completed', true)
            setToast({ message: "You're all set! Tap ? anytime for a refresher.", variant: 'success' })
            setTimeout(() => setToast(null), 4000)
          }}
          onTourSkip={() => {
            setShowMobileTour(false)
            exitOnboardingTourView()
            updateOnboarding('mobile_project_tour_skipped', true)
          }}
        />
      )}

      <input
        ref={mobileReplaceInputRef}
        type="file"
        accept="audio/*,.mid,.midi"
        className="hidden"
        onChange={handleMobileReplaceFile}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.mp3,.mid,.midi,audio/wav,audio/x-wav,audio/mpeg,audio/mp3,audio/midi,audio/x-midi"
        multiple
        className="hidden"
        onChange={handleAddTrack}
      />

      {!isMobilePortrait && (
      <>
      {/* Header */}
      {isShortLandscape ? (
        <header className="flex items-center shrink-0 px-4 h-9 border-b border-border bg-background mixer-topbar topbar-compact">
          <button
            type="button"
            className="project-sidebar-toggle"
            onClick={() => setSidebarOpen(v => !v)}
            aria-label="Toggle sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="3.5" width="12" height="1.25" rx="0.6" fill="currentColor"/>
              <rect x="2" y="7.375" width="12" height="1.25" rx="0.6" fill="currentColor"/>
              <rect x="2" y="11.25" width="12" height="1.25" rx="0.6" fill="currentColor"/>
            </svg>
          </button>
          <span className="text-[11px] truncate flex-1 text-muted-foreground uppercase tracking-widest">{project?.name}</span>
          <CommentToggleBtn
            active={commentMode}
            count={totalComments}
            onClick={toggleCommentMode}
            className="size-7"
          />
          <TourHelpButton onClick={() => setShowTour(true)} />
        </header>
      ) : (
        <AppHeader
          left={
            <button
              type="button"
              className="project-sidebar-toggle lg:hidden size-8 border border-border bg-surface-2 grid place-items-center text-muted-foreground hover:border-lime hover:text-lime transition shrink-0"
              onClick={() => setSidebarOpen(v => !v)}
              aria-label="Toggle sidebar"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="3.5" width="12" height="1.25" rx="0.6" fill="currentColor"/>
                <rect x="2" y="7.375" width="12" height="1.25" rx="0.6" fill="currentColor"/>
                <rect x="2" y="11.25" width="12" height="1.25" rx="0.6" fill="currentColor"/>
              </svg>
            </button>
          }
          crumbs={
            project ? (
              <>
                <Link href={`/band/${bandId}`} className="tb-type-name text-xs hover:text-foreground no-underline text-muted-foreground">
                  {project.band_name ?? 'Band'}
                </Link>
                <span className="text-border">/</span>
                <span className="tb-type-name text-xs text-foreground truncate">{project.name}</span>
              </>
            ) : (
              <>
                <Skeleton width={72} height={12} className="inline-block align-middle" />
                <span className="text-border">/</span>
                <Skeleton width={120} height={14} className="inline-block align-middle" />
              </>
            )
          }
          right={headerActions}
        />
      )}

      {isMobileLandscape && (
        <MobileMixerVersionBar
          versions={displayVersions}
          activeId={activeVersionId}
          onSelect={selectVersion}
          onNewBranch={() => setShowBranchModal(true)}
          onRenameVersion={handleRenameVersion}
          onDeleteVersion={requestDeleteVersion}
          commentMode={commentMode}
          commentCount={totalComments}
          onToggleCommentMode={toggleCommentMode}
          versionSwitchDisabled={versionSwitchLocked}
        />
      )}

      {/* Short-landscape bottom sheet — all topbar actions */}
      {topbarSheetOpen && (
        <>
          <div
            onClick={() => setTopbarSheetOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 300 }}
          />
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 301,
            background: 'var(--bg-surface)',
            borderTop: '0.5px solid var(--border)',
            borderRadius: '12px 12px 0 0',
            padding: '8px 0 12px',
          }}>
            {/* Sheet handle */}
            <div style={{ width: 32, height: 3, borderRadius: 2, background: 'var(--border-light)', margin: '0 auto 8px' }} />
            <button onClick={() => { handleShare(); setTopbarSheetOpen(false) }} style={sheetBtnStyle}>
              <svg width="16" height="16" viewBox="0 0 13 13" fill="none"><path d="M5.5 9a2.5 2.5 0 0 1 0-5h1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/><path d="M7.5 4a2.5 2.5 0 0 1 0 5h-1" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/><path d="M4.5 6.5h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
              Share link
            </button>
            <a href={`/api/versions/${activeVersionId}/export`} style={sheetBtnStyle} onClick={() => { trackEvent('export_wav_clicked'); setTopbarSheetOpen(false) }}>
              <svg width="16" height="16" viewBox="0 0 13 13" fill="none"><path d="M6.5 2v7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/><path d="M3.5 7l3 3 3-3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 11h9" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
              Export WAV
            </a>
            <button
              onClick={() => { if (canSaveVersion) { handleMergeClick(activeVersionId); setTopbarSheetOpen(false) } }}
              disabled={!canSaveVersion}
              style={{ ...sheetBtnStyle, opacity: !canSaveVersion ? 0.4 : 1 }}
            >
              <svg width="16" height="16" viewBox="0 0 13 13" fill="none"><path d="M2 11V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/><path d="M4 6h5M4 8.5h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
              Save version
            </button>
            <button onClick={() => { setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'); setTopbarSheetOpen(false) }} style={sheetBtnStyle}>
              {resolvedTheme === 'dark'
                ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.5"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              }
              {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <button onClick={() => { setShowTour(true); setTopbarSheetOpen(false) }} style={sheetBtnStyle}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2"/><path d="M8 11V8M8 5.5v.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              Help
            </button>
          </div>
        </>
      )}

      {/* Body — only when project is loaded; header above always renders */}
      {project ? (<>
      {/* Cherry-pick diff view — replaces sidebar + mixer while active.
          The mixer below stays mounted (hidden) so its state survives the round-trip. */}
      {cherryPickDiff && (
        <CherryPickDiff
          project={project}
          versions={versions}
          branchId={cherryPickDiff.branchId}
          targetVersionId={cherryPickDiff.targetVersionId}
          onExit={() => setCherryPickDiff(null)}
          onApplied={handleCherryPickApplied}
        />
      )}
      <div className={`flex-1 overflow-hidden ${cherryPickDiff ? 'hidden' : 'flex'}`}>
        {/* Backdrop — only visible on tablet/mobile when sidebar is open */}
        <div
          className={`sidebar-backdrop${sidebarOpen ? ' sidebar-open' : ''}`}
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
        <Sidebar
          versions={displayVersions} activeId={activeVersionId}
          onSelect={id => { selectVersion(id); if (window.innerWidth < 1024) setSidebarOpen(false) }}
          onNewBranch={() => setShowBranchModal(true)}
          onMerge={handleMergeClick}
          onRenameVersion={handleRenameVersion}
          storageUsed={storageUsed}
          storageLimit={storageLimit}
          storageFull={storageFull}
          commentCounts={commentCounts}
          projectId={projectId}
          projectName={project?.name ?? ''}
          isOpen={sidebarOpen}
          compact={isMobileLandscape}
          isDark={resolvedTheme === 'dark'}
          resourceFilterTrackId={resourceFilterTrackId}
          resourceFilterTrackName={resourceFilterTrackName}
          onClearResourceFilter={() => setResourceFilterTrackId(null)}
          onNavigateResourceVersion={navigateResourceVersion}
          onNavigateResourceTrack={navigateResourceTrack}
          versionSwitchDisabled={versionSwitchLocked}
        />

        <main
          className="flex flex-col flex-1 overflow-hidden min-w-0 bg-background relative"
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('[data-track-row]')) {
              setResourceFilterTrackId(null)
            }
          }}
          onDragOver={handleContentDragOver}
          onDragLeave={handleContentDragLeave}
          onDrop={handleContentDrop}
        >
          {/* Full-screen drag overlay */}
          {isDragging && (
            <div className="absolute inset-0 z-[200] pointer-events-none border-2 border-dashed border-lime bg-lime-soft/50 flex flex-col items-center justify-center gap-2">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-lime">
                <path d="M16 4v16M8 14l8-8 8 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M4 26h24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
              <span className="text-sm font-medium text-lime uppercase tracking-widest">Drop files to add tracks</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest">WAV · MP3 · MIDI</span>
            </div>
          )}

          {/* Content — dimmed while dragging */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', opacity: isDragging ? 0.4 : 1, transition: 'opacity 0.15s' }}>

          {/* Project header */}
          {isMobileLandscape ? (
            <section className="border-b border-border bg-surface/40 shrink-0 px-4 py-1.5">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground tabular-nums flex items-center gap-x-3 overflow-x-auto whitespace-nowrap scrollbar-none">
                <ProjectMetaFields
                  projectId={projectId}
                  bpm={project.bpm}
                  keySig={project.key}
                  timeSig={project.time_signature}
                  onUpdated={patch => setProject(p => p ? { ...p, ...patch } : p)}
                  variant="header"
                />
                <span>{activeTracks.length} TRACK{activeTracks.length !== 1 ? 'S' : ''}</span>
                {player.duration > 0 && <span>{fmtTime(player.duration)}</span>}
              </div>
            </section>
          ) : (
          <section className="border-b border-border bg-surface/40 shrink-0">
            <div className="px-4 sm:px-6 py-3 flex flex-col gap-2">
              <div className="flex items-center gap-3 flex-wrap min-w-0">
                {projectNameEditing ? (
                  <input
                    ref={projectNameInputRef}
                    value={projectNameValue}
                    onChange={e => setProjectNameValue(e.target.value.slice(0, 80))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitProjectRename()
                      if (e.key === 'Escape') setProjectNameEditing(false)
                    }}
                    onBlur={commitProjectRename}
                    className="tb-type-name text-xl uppercase tracking-tight bg-background border border-lime px-2 py-1 outline-none max-w-full"
                  />
                ) : (
                  <div className="flex items-center gap-2 group min-w-0" onDoubleClick={startProjectRename}>
                    <h1
                      className={`tb-type-name text-3xl sm:text-4xl uppercase tracking-tighter truncate m-0 transition-colors ${
                        projectNameFlash ? 'text-lime' : 'text-foreground'
                      }`}
                    >
                      {project.name}
                    </h1>
                    <button
                      type="button"
                      onClick={startProjectRename}
                      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-lime bg-transparent border-0 cursor-pointer p-0"
                      title="Rename project"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M8.5 1.5l2 2L4 10H2v-2L8.5 1.5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                )}
                {roadmap.configured && roadmap.stepIndex != null && (
                  <RoadmapPreview
                    steps={roadmap.steps}
                    stepIndex={roadmap.stepIndex}
                    stageSince={roadmap.stageSince}
                  />
                )}
              </div>

              <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
                <ProjectMetaFields
                  projectId={projectId}
                  bpm={project.bpm}
                  keySig={project.key}
                  timeSig={project.time_signature}
                  onUpdated={patch => setProject(p => p ? { ...p, ...patch } : p)}
                  variant="header"
                />
                <span>{activeTracks.length} TRACK{activeTracks.length !== 1 ? 'S' : ''}</span>
                {totalProjectDurationMs > 0 && <span>{fmtTime(totalProjectDurationMs / 1000)}</span>}
              </div>

              <div className="flex min-w-0 items-stretch">
                <MixerToolbarGroup label="Version" padX="pl-0 pr-3">
                  <VersionToolbarDropdown
                    versions={versions}
                    activeId={activeVersionId}
                    onSelect={selectVersion}
                    versionSwitchDisabled={versionSwitchLocked}
                  />
                  <button
                    type="button"
                    onClick={() => setShowBranchModal(true)}
                    data-tour="new-branch-button"
                    className="shrink-0 inline-flex items-center gap-1.5 bg-surface/40 text-[10px] uppercase tracking-widest px-2.5 py-1.5 border border-dashed border-border hover:border-lime hover:text-lime text-muted-foreground transition"
                  >
                    + New Version
                  </button>
                  {(() => {
                    if (abCompareLocked) {
                      return (
                        <PaywallLockWrap className="shrink-0">
                          <button
                            type="button"
                            data-tour="compare-button"
                            onClick={onAbCompareLockedClick}
                            className={`inline-flex items-center gap-1.5 bg-surface/40 text-[10px] uppercase tracking-widest px-2.5 py-1.5 border border-border text-muted-foreground ${paywallLockedButtonClass}`}
                          >
                            <ChevronsLeftRightEllipsis size={12} strokeWidth={1.75} className="shrink-0" aria-hidden />
                            Compare
                          </button>
                        </PaywallLockWrap>
                      )
                    }
                    const canCompare = versions.length >= 2
                    const compareBtn = (
                      <button
                        type="button"
                        data-tour="compare-button"
                        disabled={!canCompare}
                        onClick={() => {
                          const other = versions.find(v => v.id !== activeVersionId)
                          if (!other) return
                          const enterCompare = () => {
                            setCompareVersionBId(other.id)
                            setCompareActive(true)
                            if (playerRef.current.playing) playerRef.current.pause()
                          }
                          if (editSessionRef.current) {
                            setEditConfirm({
                              title: 'Unsaved track edits',
                              body: `Discard all changes to “${editingTrackNameRef.current}”? Compare mode ends the edit session.`,
                              cancelLabel: 'Keep editing',
                              confirmLabel: 'Discard changes',
                              danger: true,
                              action: () => {
                                discardEditSession()
                                enterCompare()
                              },
                            })
                            return
                          }
                          enterCompare()
                        }}
                        className="shrink-0 inline-flex items-center gap-1.5 bg-surface/40 text-[10px] uppercase tracking-widest px-2.5 py-1.5 border border-border hover:border-lime hover:text-lime text-muted-foreground transition disabled:opacity-40 disabled:pointer-events-none disabled:hover:border-border disabled:hover:text-muted-foreground"
                      >
                        <ChevronsLeftRightEllipsis size={12} strokeWidth={1.75} className="shrink-0" aria-hidden />
                        Compare
                      </button>
                    )
                    if (canCompare) return compareBtn
                    return (
                      <HoverTooltip label="Create a version first to compare">
                        <span className="inline-flex">{compareBtn}</span>
                      </HoverTooltip>
                    )
                  })()}
                  {activeVersion?.type === 'branch' && (
                    <button
                      type="button"
                      onClick={() => requestDeleteVersion(activeVersion.id)}
                      data-tour="delete-version-button"
                      className="shrink-0 inline-flex items-center gap-1.5 bg-surface/40 text-[10px] uppercase tracking-widest px-2.5 py-1.5 border border-destructive text-destructive hover:bg-destructive/10 transition"
                    >
                      <Trash2 size={12} strokeWidth={1.75} className="shrink-0" aria-hidden />
                      Delete
                    </button>
                  )}
                </MixerToolbarGroup>

                <MixerToolbarSeparator />

                <MixerToolbarGroup label="Mode">
                  <button
                    type="button"
                    onClick={toggleEditStructure}
                    disabled={activeTracks.length === 0}
                    data-tour="edit-structure-button"
                    className={`text-[10px] uppercase tracking-widest px-2.5 py-1.5 border transition disabled:opacity-40 ${
                      editStructure || sections.length > 0
                        ? 'border-lime text-lime bg-lime-soft'
                        : 'border-border text-muted-foreground hover:border-lime hover:text-lime'
                    }`}
                  >
                    {editStructure ? 'Done editing' : sections.length > 0 ? 'Edit structure' : '+ Add structure'}
                  </button>
                  <button
                    type="button"
                    onClick={toggleCommentMode}
                    data-tour="comments-toggle"
                    className={`text-[10px] uppercase tracking-widest px-2.5 py-1.5 border transition inline-flex items-center gap-1.5 ${
                      commentMode
                        ? 'bg-lime text-primary-foreground border-lime'
                        : 'border-border text-muted-foreground hover:border-lime hover:text-lime'
                    }`}
                  >
                    {commentMode ? '● Add comment' : 'Add comment'}
                    {totalComments > 0 && (
                      <span
                        className={`inline-flex items-center justify-center min-w-4 h-4 px-1 text-[9px] font-bold leading-none ${
                          commentMode
                            ? 'bg-primary-foreground text-lime'
                            : 'bg-lime text-primary-foreground'
                        }`}
                      >
                        {totalComments}
                      </span>
                    )}
                  </button>
                </MixerToolbarGroup>

                <MixerToolbarSeparator />

                <MixerToolbarGroup label="Plan">
                  <button
                    type="button"
                    onClick={togglePlanOpen}
                    className={`text-[10px] uppercase tracking-widest px-2.5 py-1.5 border inline-flex items-center gap-1.5 transition ${
                      planOpen
                        ? 'bg-lime text-primary-foreground border-lime'
                        : 'border-border text-muted-foreground hover:border-lime hover:text-lime'
                    }`}
                  >
                    {planOpen ? 'Hide plan' : 'Roadmap & checklist'}
                  </button>
                </MixerToolbarGroup>

                <MixerToolbarGroup label="Actions" padX="pl-3 pr-0" className="ml-auto">
                  <TbBtn variant="ghost" onClick={handleShare} data-tour="share-button">
                    {shareCopied ? 'Copied!' : 'Share'}
                  </TbBtn>
                  <TbBtn
                    variant="ghost"
                    disabled={!canSaveVersion}
                    onClick={() => canSaveVersion && handleMergeClick(activeVersionId)}
                    data-tour="save-version-button"
                    title={canSaveVersion ? 'Apply this version' : 'Switch to a version to apply changes'}
                  >
                    Save Version
                  </TbBtn>
                  <a
                    href={`/api/versions/${activeVersionId}/export`}
                    onClick={() => trackEvent('export_wav_clicked')}
                    className="inline-flex bg-foreground text-background px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest hover:bg-lime hover:text-primary-foreground transition no-underline items-center"
                  >
                    Export WAV
                  </a>
                </MixerToolbarGroup>
              </div>
            </div>
          </section>
          )}

          {/* Roadmap + checklist panel */}
          {planOpen && !compareActive && (
            <section className="border-b border-border bg-background shrink-0">
              <div className="px-4 sm:px-6 py-5 grid gap-5 lg:grid-cols-[1fr_minmax(300px,420px)] items-start">
                <SongRoadmap
                  projectId={projectId}
                  roadmap={roadmap}
                  onRoadmapChange={handleRoadmapChange}
                />
                <SongChecklist
                  items={checklist}
                  members={checklistMembers}
                  onToggle={handleChecklistToggle}
                  onUpdate={handleChecklistUpdate}
                  onDelete={handleChecklistDelete}
                  onAssign={handleChecklistAssign}
                  onAdd={handleChecklistAdd}
                />
              </div>
            </section>
          )}

          {/* Compare mode — replaces track list when active */}
          {compareActive && project && (
            <CompareMode
              project={project}
              versions={versions}
              initialVersionAId={activeVersionId}
              initialVersionBId={compareVersionBId}
              onExit={() => setCompareActive(false)}
              onSetMaster={versionId => {
                selectVersion(versionId)
                setCompareActive(false)
              }}
              transportSlot={compareTransportSlot}
            />
          )}

          {/* Structure + transport — bar ruler, sections, play/time/volume */}
          {!compareActive && project && (
            <StructureOverlay
              project={project}
              versionId={activeVersionId}
              totalDurationMs={totalProjectDurationMs}
              tracks={activeTracks}
              sections={sections}
              onSectionsChange={setSections}
              editMode={isMobileLandscape ? false : editStructure}
              onEditModeChange={setEditStructure}
              waveformBounds={waveformBounds}
              currentTimeMs={player.currentTime * 1000}
              currentTimeRef={player.currentTimeRef}
              playing={player.playing}
              onSeek={player.seek}
              compact={isMobileLandscape}
              seekEnabled={waveformsInteractive}
              tourOpenFirstSection={
                featureTour === 'structure'
                && !structureTourHadSections
                && sections.length > 0
              }
              onNamingChange={setStructureNaming}
              onActiveEditChange={setStructureSectionOpen}
            />
          )}

          {/* Comment mode banner + track list — hidden when compare mode is active */}
          {!compareActive && <>

          {/* Comment mode banner — desktop only; mobile uses top-bar icon */}
          {!isMobileLandscape && (
          <div className={`overflow-hidden transition-[height,opacity] duration-200 shrink-0 ${commentMode ? 'h-9 opacity-100' : 'h-0 opacity-0'}`}>
            <div className="flex items-center gap-2 px-4 sm:px-6 h-9 bg-lime-soft border-b border-lime/30">
              <span className="text-[10px] uppercase tracking-widest text-lime">
                ● Comment mode — click-drag on any waveform to select a time range
              </span>
            </div>
          </div>
          )}

          {/* Track list */}
          <div ref={trackListRef} data-track-scroll className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-none relative">
            <div ref={tracksBodyRef} className="relative">

              {/* Tact grid + section boundary overlays */}
              {totalProjectBars > 0 && (() => {
                const { barDurationMs } = getBarMath(project!, totalProjectDurationMs)
                const wl = waveformBounds?.left ?? TRACK_LABEL_W
                const wr = waveformBounds?.right ?? 68
                return (
                  <div style={{
                    position: 'absolute', top: 0, bottom: 0,
                    left: wl, right: wr,
                    pointerEvents: 'none', zIndex: 1,
                  }}>
                    <TactGrid totalBars={totalProjectBars} barDurationMs={barDurationMs} totalDurationMs={totalProjectDurationMs} />
                    {sections.length > 0 && totalProjectDurationMs > 0 && [...new Set(sections.flatMap(s => [
                      ...(s.start_bar > 0 ? [s.start_bar] : []),
                      s.end_bar,
                    ]))].map(bar => {
                      const pct = (bar * barDurationMs) / totalProjectDurationMs
                      return (
                        <div
                          key={bar}
                          style={{
                            position: 'absolute', top: 0, height: '100%',
                            left: `${pct * 100}%`,
                            width: 0,
                            borderLeft: '1px dashed rgba(128,128,128,0.45)',
                          }}
                        />
                      )
                    })}
                  </div>
                )
              })()}

              {activeTracks.length === 0 ? (
                <div className="px-4 sm:px-6 py-12 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
                  {versionLoading ? 'Loading tracks…' : 'No tracks yet — add one below'}
                </div>
              ) : activeTracks.map((t, i) => (
                <TrackRow
                  key={t.id} track={t} index={i}
                  muted={player.mutedTracks.has(t.id) || player.midiRenderingTracks.has(t.id)}
                  soloed={player.soloedTracks.has(t.id)} changed={isChanged(t)}
                  isReplacing={replacingTrackId === t.id}
                  currentTimeRef={player.currentTimeRef}
                  commentMode={commentMode} activeInput={activeCommentInput}
                  audioReady={
                    t.file_type === 'midi'
                      ? player.midiPlaybackReadyIds.has(t.id)
                      : player.loaded >= player.total && player.total > 0
                  }
                  midiRendering={player.midiRenderingTracks.has(t.id)}
                  waitForMidiRender={player.waitForMidiRender}
                  onToggleMute={() => player.toggleMute(t.id)}
                  onToggleSolo={() => player.toggleSolo(t.id)}
                  trackGain={player.trackGains.get(t.id) ?? 1}
                  onTrackGainChange={gain => player.setTrackGain(t.id, gain)}
                  onReplace={f => requestReplaceTrack(t, f)}
                  onCommentPlace={setActiveCommentInput}
                  onCommentDelete={handleCommentDelete}
                  onCommentCreate={handleCommentCreate}
                  onCloseInput={() => setActiveCommentInput(null)}
                  onDeleteTrack={requestDeleteTrack}
                  onRenameTrack={handleRenameTrack}
                  onColorUpdate={handleColorUpdate}
                  onMidiDataUpdate={handleMidiDataUpdate}
                  onStartBarUpdate={requestStartBarUpdate}
                  onDragStartOffset={() => setDraggingTrackId(t.id)}
                  onDragEndOffset={() => setDraggingTrackId(null)}
                  otherTrackDragging={draggingTrackId !== null && draggingTrackId !== t.id}
                  waveformDimmed={
                    player.mutedTracks.has(t.id)
                    || player.midiRenderingTracks.has(t.id)
                    || (player.soloedTracks.size > 0 && !player.soloedTracks.has(t.id))
                  }
                  waveformsInteractive={waveformsInteractive}
                  onSeek={isDesktopMixer ? player.seek : undefined}
                  currentUserId={user?.id}
                  isOwner={isOwner}
                  onReplyCreate={handleReplyCreate}
                  currentUser={currentUser}
                  projectId={projectId}
                  versionId={activeVersionId}
                  project={project}
                  totalBars={totalProjectBars}
                  runtimeDurationMs={effectiveTrackDurationMs(t)}
                  timelineDurationMs={totalProjectDurationMs}
                  onTrackDuration={handleTrackDuration}
                  compact={isMobileLandscape}
                  resourceFilterActive={resourceFilterTrackId === t.id}
                  onResourceFilter={setResourceFilterTrackId}
                  editable={isDesktopMixer && t.file_type !== 'midi'}
                  editing={editSession?.trackId === t.id}
                  editBusy={editApplyStatus === 'processing' && editSession?.trackId === t.id}
                  onRequestEdit={() => handleRequestEdit(t)}
                  onEditApply={requestEditApply}
                  onEditCancel={requestEditCancel}
                  editArea={editSession?.trackId === t.id ? (
                    <TrackEditArea
                      session={editSession}
                      isFirstTrack={i === 0}
                      color={trackAccentColor(t.icon_color, i)}
                      labelW={TRACK_LABEL_W}
                      rowH={TRACK_ROW_H}
                      totalBars={totalProjectBars}
                      barDurationMs={projBarDurationMs}
                      totalDurationMs={totalProjectDurationMs}
                      currentTimeRef={player.currentTimeRef}
                      applyStatus={editApplyStatus}
                      applyError={editApplyError}
                      onSeekBar={handleEditSeekBar}
                      onSelect={handleEditSelect}
                      onSeparate={handleEditSeparate}
                      onRemove={handleEditRemove}
                      onDuplicate={handleEditDuplicate}
                      onCopy={handleEditCopy}
                      onPaste={handleEditPaste}
                      onMoveSegment={handleEditMoveSegment}
                      onTrimSegmentStart={handleEditTrimSegmentStart}
                      onTrimSegmentEnd={handleEditTrimSegmentEnd}
                      onUndo={handleEditUndo}
                      onRedo={handleEditRedo}
                      onRequestCancel={requestEditCancel}
                      onRetryApply={() => { void performEditApply() }}
                    />
                  ) : undefined}
                />
              ))}
              {recordingSessions.map(session => (
                <RecordingTrackRow
                  key={session.id}
                  id={session.id}
                  name={session.name}
                  onNameChange={handleRecordingNameChange}
                  versionId={activeVersionId}
                  bpm={projBpm}
                  timeSig={projTimeSig}
                  totalBars={totalProjectBars}
                  countdownEnabled={player.countdownOn}
                  getPlaybackMs={getRecordingPlaybackMs}
                  isPlaying={player.playing}
                  seekEpoch={player.seekEpoch}
                  isActiveRecording={activeRecordingId !== null && activeRecordingId !== session.id}
                  onArm={handleRecordingArm}
                  onRelease={handleRecordingRelease}
                  onSaved={handleRecordingSaved}
                  onDelete={handleRecordingDelete}
                  onPlaybackStart={player.playTransport}
                  onPlaybackStop={player.pause}
                  onSeekTo={player.seek}
                  onPreparePlayback={player.prepareTransport}
                  onPreviewTimelineChange={handleRecordingPreviewTimeline}
                  recordingStopRef={recordingStopRef}
                  playCountdown={beginRecordingCountdown}
                  registerControl={registerRecordingControl}
                  onStateChange={handleRecordingStateChange}
                  getPreviewOutput={player.getPreviewOutput}
                />
              ))}

              {/* Upload progress rows */}
              {uploads.length >= 2 && uploads.some(u => u.status !== 'done' && u.status !== 'error') && (
                <div style={{ padding: '6px 22px', background: 'var(--bg-card)', borderBottom: '0.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>
                    Uploading {uploads.filter(u => u.status !== 'done' && u.status !== 'error').length} files…
                  </span>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                    <div style={{
                      width: `${uploads.reduce((s, u) => s + u.progress, 0) / Math.max(uploads.length, 1)}%`,
                      height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width 0.3s ease',
                    }} />
                  </div>
                </div>
              )}
              {uploads.map(u => (
                <UploadRow
                  key={u.id}
                  upload={u}
                  onRetry={() => retryUpload(u.id)}
                  onDismiss={() => removeUpload(u.id)}
                />
              ))}

              {/* Add track — uikit split row */}
              <div
                data-tour="add-track-row"
                className="flex border-t border-border"
                onDragOver={handleAddRowDragOver}
                onDragLeave={handleAddRowDragLeave}
                onDrop={handleAddRowDrop}
              >
                <div
                  className="shrink-0 border-r border-border"
                  style={{ width: TRACK_LABEL_W }}
                >
                  <button
                    type="button"
                    onClick={openAddTrackPicker}
                    disabled={uploading || storageFull}
                    className={`w-full min-h-[60px] p-4 text-left text-[10px] uppercase tracking-widest transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      isDraggingAddRow
                        ? 'text-lime bg-lime-soft'
                        : 'text-muted-foreground hover:text-lime hover:bg-surface/30'
                    }`}
                  >
                    {isDraggingAddRow ? '↓ Drop to add track' : '+ Add track'}
                  </button>
                  <button
                    type="button"
                    onClick={handleAddRecordingTrack}
                    disabled={!activeVersionId || storageFull}
                    data-tour="record-track-button"
                    className="w-full min-h-[48px] px-4 text-left text-[10px] uppercase tracking-widest text-muted-foreground hover:text-lime hover:bg-surface/30 transition disabled:opacity-40 disabled:cursor-not-allowed border-t border-border flex items-center gap-2"
                  >
                    <span className="inline-block w-2 h-2 rounded-full shrink-0 bg-destructive" />
                    Record track
                  </button>
                </div>
                <div className="flex-1 min-h-[108px] relative overflow-hidden">
                  <TactGrid totalBars={totalProjectBars} barDurationMs={projBarDurationMs} totalDurationMs={totalProjectDurationMs} />
                </div>
              </div>
              {uploads.some(u => u.status !== 'done' && u.status !== 'error') && (
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground px-4 sm:px-6 py-2 m-0 border-t border-border">
                  {uploads.filter(u => u.status !== 'done' && u.status !== 'error').length > 1
                    ? `Uploading ${uploads.filter(u => u.status !== 'done' && u.status !== 'error').length} files…`
                    : (() => {
                        const u = uploads.find(u => u.status !== 'done' && u.status !== 'error')
                        return u?.status === 'uploading'
                          ? `Uploading… ${u.progress}%`
                          : u?.status === 'processing' ? 'Processing…' : 'Preparing…'
                      })()
                  }
                </p>
              )}
            </div>
          </div>

          </>}{/* end !compareActive */}

          </div>{/* end content dim wrapper */}
        </main>
      </div>

      {cherryPickDiff
        ? null /* diff view renders its own transport */
        : compareActive
        ? <div ref={setCompareTransportSlot} className="shrink-0" />
        : <MasterPlayerBar
            playing={player.playing}
            currentTime={player.currentTime}
            currentTimeRef={player.currentTimeRef}
            duration={Math.max(player.duration, totalProjectDurationMs / 1000)}
            loaded={player.loaded}
            total={player.total}
            volume={player.volume}
            onPlay={player.play}
            onPause={player.pause}
            onSeek={player.seek}
            onVolume={player.setVolume}
            metronomeOn={player.metronomeOn}
            countdownOn={player.countdownOn}
            isCounting={player.isCounting}
            onToggleMetronome={player.toggleMetronome}
            onToggleCountdown={player.toggleCountdown}
            sectionLoopOn={player.sectionLoopOn}
            sectionLoopEnabled={sectionLoopButtonEnabled}
            onToggleSectionLoop={handleToggleSectionLoop}
            compact={isMobileLandscape}
          />
      }

      {!compareActive && !cherryPickDiff && !isMobileLandscape && (
      <StatusFooter
        left={
          <span className="uppercase tracking-widest truncate hidden sm:inline">
            {project.bpm != null && `${project.bpm} BPM · `}
            {project.key && `${project.key} · `}
            {project.time_signature ?? '4/4'} · {activeTracks.length} TRACKS · {totalComments} COMMENTS
          </span>
        }
        right={<span className="uppercase tracking-widest hidden sm:inline">{project.name.toUpperCase()}</span>}
      />
      )}
      </>) : (
        /* Loading body — AppHeader above is always visible */
        <>
        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            versions={displayVersions}
            activeId={activeVersionId}
            onSelect={selectVersion}
            onNewBranch={() => setShowBranchModal(true)}
            onMerge={handleMergeClick}
            storageUsed={storageUsed}
            storageLimit={storageLimit}
            storageFull={storageFull}
            commentCounts={commentCounts}
            projectId={projectId}
            projectName=""
            isOpen={sidebarOpen}
            compact={isMobileLandscape}
            isDark={resolvedTheme === 'dark'}
            versionSwitchDisabled
            deferResources
          />
          <main className="flex flex-col flex-1 overflow-hidden min-w-0 bg-background">
            {/* Project name / meta header — name + meta skeletons; action buttons are real */}
            <section className="border-b border-border bg-surface/40 shrink-0">
              <div className="px-4 sm:px-6 py-3 flex flex-col gap-2">
                <div className="flex items-center gap-3 flex-wrap min-w-0">
                  <Skeleton width={260} height={28} />
                </div>
                <div className="flex items-center gap-3">
                  <Skeleton width={64} height={12} />
                  <Skeleton width={36} height={12} />
                  <Skeleton width={44} height={12} />
                  <Skeleton width={72} height={12} />
                </div>
                <div className="flex min-w-0 items-stretch">
                  {(['Version', 'Mode', 'Plan', 'Actions'] as const).map((label, i) => (
                    <Fragment key={label}>
                      <div
                        className={`flex flex-col gap-1 py-2 shrink-0 ${
                          i === 0 ? 'pl-0 pr-3' : i === 3 ? 'pl-3 pr-0 ml-auto' : 'px-3'
                        }`}
                      >
                        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground leading-none">
                          {label}
                        </span>
                        <div className="flex items-center gap-1.5 min-h-[28px]">
                          <Skeleton width={label === 'Version' ? 88 : label === 'Actions' ? 52 : 96} height={28} />
                          {label === 'Version' && <Skeleton width={88} height={28} />}
                          {label === 'Actions' && (
                            <>
                              <Skeleton width={72} height={28} />
                              <Skeleton width={76} height={28} />
                            </>
                          )}
                        </div>
                      </div>
                      {i < 2 && <MixerToolbarSeparator />}
                    </Fragment>
                  ))}
                </div>
              </div>
            </section>
            {/* CHANNEL + STRUCTURE rows — real labels, matching StructureEditor layout */}
            <div className="flex items-stretch border-b border-border shrink-0">
              <div
                className="shrink-0 border-r border-border flex flex-col bg-surface/40"
                style={{ width: TRACK_LABEL_W }}
              >
                {/* CHANNEL cell — mirrors StructureEditor RULER_H=40 row */}
                <div className="border-b border-border px-3 flex items-center flex-col justify-between" style={{ height: 40 }}>
                  <span className="pt-2 text-[9px] uppercase font-bold tracking-widest text-muted-foreground">CHANNEL</span>
                  <span className="pb-1.5 font-mono text-foreground/60 font-normal text-[9px]">— · —</span>
                </div>
                {/* STRUCTURE cell — mirrors StructureEditor RIBBON_H=32 row */}
                <div className="px-3 flex flex-col items-center justify-center gap-0.5 bg-lime-soft/40" style={{ height: 32 }}>
                  <span className="text-[9px] uppercase font-bold tracking-widest text-lime">STRUCTURE</span>
                </div>
              </div>
              <div className="flex-1 min-w-0 flex flex-col bg-surface">
                <div className="border-b border-border bg-surface/40" style={{ height: 40 }} />
                <div className="bg-lime-soft/10" style={{ height: 32 }} />
              </div>
            </div>
            {/* Track list */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {[0, 1, 2, 3, 4].map(i => <TrackRowSkeleton key={i} />)}
            </div>
          </main>
        </div>
        {/* Transport bar — outside the sidebar+main row so it spans full width */}
        <MasterPlayerBar
          playing={false}
          currentTime={0}
          currentTimeRef={player.currentTimeRef}
          duration={0}
          loaded={0}
          total={0}
          volume={player.volume}
          onPlay={() => {}}
          onPause={() => {}}
          onSeek={() => {}}
          onVolume={player.setVolume}
          metronomeOn={player.metronomeOn}
          countdownOn={player.countdownOn}
          isCounting={false}
          onToggleMetronome={player.toggleMetronome}
          onToggleCountdown={player.toggleCountdown}
          sectionLoopOn={false}
          sectionLoopEnabled={false}
          onToggleSectionLoop={() => {}}
          compact={isMobileLandscape}
        />
        <StatusFooter />
        </>
      )}
      </>
      )}

      {/* Onboarding tour */}
      <ProjectTour
        projectName={project?.name ?? 'this project'}
        show={showTour && isDesktopMixer}
        onFinish={() => {
          setShowTour(false)
          exitOnboardingTourView()
          updateOnboarding('project_tour_completed', true)
          setToast({ message: "You're all set! Click the ? icon anytime for a refresher.", variant: 'success' })
          setTimeout(() => setToast(null), 4000)
        }}
        onSkip={() => {
          setShowTour(false)
          exitOnboardingTourView()
          updateOnboarding('project_tour_skipped', true)
        }}
      />

      <ProjectTour
        projectName={project?.name ?? 'this project'}
        show={featureTour === 'compare' && isDesktopMixer}
        steps={COMPARE_TOUR_STEPS}
        onFinish={() => finishFeatureTour('compare', false)}
        onSkip={() => finishFeatureTour('compare', true)}
      />
      <ProjectTour
        projectName={project?.name ?? 'this project'}
        show={featureTour === 'structure' && isDesktopMixer}
        steps={structureTourSteps}
        onFinish={() => finishFeatureTour('structure', false)}
        onSkip={() => finishFeatureTour('structure', true)}
      />

      {trackEditShortcutsOpen && (
        <TrackEditShortcutsModal
          onDismiss={() => {
            setTrackEditShortcutsOpen(false)
            finishFeatureTour('track_edit', false)
          }}
        />
      )}

      {masterEditModal && (
        <MasterEditConfirmModal
          onConfirm={suppress24h => {
            if (suppress24h) suppressMasterEditGuard24h()
            const { pending } = masterEditModal
            setMasterEditModal(null)
            void pending()
          }}
          onNewVersion={suppress24h => {
            if (suppress24h) suppressMasterEditGuard24h()
            masterEditModal.onDismiss?.()
            setMasterEditModal(null)
            setShowBranchModal(true)
          }}
          onCancel={() => {
            masterEditModal.onDismiss?.()
            setMasterEditModal(null)
          }}
        />
      )}
      {showBranchModal && <NewBranchModal onConfirm={handleNewBranch} onCancel={() => setShowBranchModal(false)} />}

      {editConfirm && (
        <TrackEditConfirmModal
          title={editConfirm.title}
          body={editConfirm.body}
          cancelLabel={editConfirm.cancelLabel}
          confirmLabel={editConfirm.confirmLabel}
          danger={editConfirm.danger}
          onCancel={() => setEditConfirm(null)}
          onConfirm={() => {
            const { action } = editConfirm
            setEditConfirm(null)
            action()
          }}
        />
      )}

      {mergeModal && (
        <MergeModal
          projectId={projectId}
          branchId={mergeModal.branchId}
          versions={versions}
          onClose={() => setMergeModal(null)}
          onMerged={handleMergeComplete}
          onOpenDiff={targetVersionId => handleOpenCherryPickDiff(mergeModal.branchId, targetVersionId)}
        />
      )}

      {deleteVersionModal && (
        <DeleteVersionModal
          name={deleteVersionModal.name}
          deleting={deletingVersion}
          onCancel={() => setDeleteVersionModal(null)}
          onConfirm={handleDeleteVersionConfirm}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast.message} variant={toast.variant} />}

      <ChatDock
        bandId={bandId}
        open={chatOpen}
        onOpen={openChat}
        onClose={closeChat}
        initialChannelKey={projectId}
        currentUserId={user?.id}
        currentProjectId={projectId}
        onSwitchVersion={selectVersion}
        onUnreadChange={setChatUnread}
      />
    </div>
  )
}
