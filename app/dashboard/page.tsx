'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { BrandSpinner } from '@/components/BrandSpinner'
import { formatActivityLine } from '@/lib/activityFormat'
import { avatarColor, avatarInitials } from '@/lib/avatarTheme'
import { usePalette } from '@/contexts/PaletteContext'
import { DashboardWelcomeModal } from '@/components/onboarding/DashboardWelcomeModal'
import { AppHeader, SectionLabel, StatusFooter } from '@/components/design/AppShell'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivityItem {
  action: string; subject: string; detail: string | null
  created_at: string; project_name: string | null
}

interface DashboardBand {
  id: string; name: string; created_at: string
  userRole: string; userRoleLabel: string | null
  projectCount: number; memberCount: number; lastUpdated: string
  latestActivity: ActivityItem | null
  storageBytes: number; storageLimitBytes: number
}

type FilterTab = 'all' | 'owner' | 'member' | 'recent'

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'owner', label: 'Owner' },
  { id: 'member', label: 'Member' },
  { id: 'recent', label: 'Recently active' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = diff / 60000
  const hours = diff / 3600000
  const days = diff / 86400000
  if (mins < 2) return 'just now'
  if (mins < 60) return `${Math.floor(mins)}m ago`
  if (hours < 24) return `${Math.floor(hours)}h ago`
  if (days < 2) return 'yesterday'
  return `${Math.floor(days)}d ago`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatLimit(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`
}

function timeGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function displayName(username?: string | null): string {
  if (!username) return 'there.'
  return `${username.charAt(0).toUpperCase()}${username.slice(1)}.`
}

// ─── Shared uikit primitives ──────────────────────────────────────────────────

function TbButton({
  children,
  variant = 'ghost',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'ghost' | 'primary' | 'danger'
}) {
  const base = 'text-[10px] uppercase tracking-widest transition disabled:opacity-50 disabled:pointer-events-none'
  const styles = {
    ghost: 'border border-border text-muted-foreground hover:border-ember hover:text-ember px-3 py-1.5',
    primary: 'bg-ember text-white border border-ember px-3 py-1.5 font-bold hover:brightness-110',
    danger: 'bg-destructive text-destructive-foreground px-3 py-1.5 font-bold',
  }
  return (
    <button type="button" className={`${base} ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

function TbInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-background border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-ember placeholder:text-muted-foreground/60 ${props.className ?? ''}`}
    />
  )
}

function TbModal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[8000] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md border border-border bg-popover p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function NewBandModal({ onClose, onCreated }: {
  onClose: () => void; onCreated: (bandId: string) => void
}) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/bands', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      const { band } = await res.json()
      onCreated(band.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally { setLoading(false) }
  }

  return (
    <TbModal onClose={onClose}>
      <p className="font-display text-lg uppercase tracking-tight text-foreground mb-4 m-0">New band</p>
      <form onSubmit={handleCreate} className="flex flex-col gap-3">
        <TbInput
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="The Noise, Blue Period…"
          autoFocus
        />
        {error && <p className="text-destructive text-xs m-0">{error}</p>}
        <div className="flex gap-2 justify-end mt-1">
          <TbButton onClick={onClose}>Cancel</TbButton>
          <TbButton type="submit" variant="primary" disabled={loading || !name.trim()} className="px-4">
            {loading ? 'Creating…' : 'Create'}
          </TbButton>
        </div>
      </form>
    </TbModal>
  )
}

function DeleteBandModal({ band, onClose, onDeleted }: {
  band: { id: string; name: string }; onClose: () => void; onDeleted: () => void
}) {
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleDelete() {
    if (confirm !== band.name) return
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/bands/${band.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <TbModal onClose={onClose}>
      <p className="font-display text-lg uppercase tracking-tight text-foreground m-0 mb-2">Delete {band.name}?</p>
      <p className="text-sm text-destructive leading-relaxed m-0 mb-4">
        This permanently deletes all projects, tracks, and versions. This cannot be undone.
      </p>
      <label className="text-[10px] uppercase tracking-widest text-muted-foreground block mb-2">
        Type the band name to confirm:
      </label>
      <TbInput
        value={confirm}
        onChange={e => setConfirm(e.target.value)}
        placeholder={band.name}
        autoFocus
        className="mb-4"
      />
      {error && <p className="text-destructive text-xs m-0 mb-3">{error}</p>}
      <div className="flex gap-2 justify-end">
        <TbButton onClick={onClose}>Cancel</TbButton>
        <TbButton variant="danger" onClick={handleDelete} disabled={confirm !== band.name || loading}>
          {loading ? 'Deleting…' : 'Delete band'}
        </TbButton>
      </div>
    </TbModal>
  )
}

function LeaveBandModal({ band, onClose, onLeft }: {
  band: { id: string; name: string }; onClose: () => void; onLeft: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLeave() {
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/bands/${band.id}/members/me`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      onLeft()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <TbModal onClose={onClose}>
      <p className="font-display text-lg uppercase tracking-tight text-foreground m-0 mb-2">Leave {band.name}?</p>
      <p className="text-sm text-muted-foreground leading-relaxed m-0 mb-4">
        You&apos;ll lose access to all projects in this band.
      </p>
      {error && <p className="text-destructive text-xs m-0 mb-3">{error}</p>}
      <div className="flex gap-2 justify-end">
        <TbButton onClick={onClose}>Cancel</TbButton>
        <TbButton variant="danger" onClick={handleLeave} disabled={loading}>
          {loading ? 'Leaving…' : 'Leave band'}
        </TbButton>
      </div>
    </TbModal>
  )
}

// ─── Band card ────────────────────────────────────────────────────────────────

function BandCard({ band, index, onNavigate, onDelete, onLeave }: {
  band: DashboardBand
  index: number
  onNavigate: () => void
  onDelete: () => void
  onLeave: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { palette } = usePalette()
  const isOwner = band.userRole === 'owner'
  const color = avatarColor(band.name, palette)
  const initials = avatarInitials(band.name, 'band')
  const storagePct = band.storageBytes / band.storageLimitBytes
  const roleLabel = (band.userRoleLabel ?? (isOwner ? 'owner' : 'member')).toLowerCase()
  const activityLine = band.latestActivity
    ? formatActivityLine(
        band.latestActivity.action,
        band.latestActivity.subject,
        band.latestActivity.detail,
        band.latestActivity.project_name,
      )
    : null

  useEffect(() => {
    if (!menuOpen) return
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  return (
    <article
      role="link"
      tabIndex={0}
      onClick={onNavigate}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate() } }}
      className="group relative bg-background p-5 hover:bg-surface transition-colors animate-slide-in cursor-pointer text-left"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-start justify-between mb-5">
        <div
          className="size-12 grid place-items-center font-display font-bold text-lg text-background shrink-0"
          style={{ backgroundColor: color }}
        >
          {initials}
        </div>
        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
          <span className={`text-[9px] font-bold uppercase tracking-widest border px-2 py-1 ${
            isOwner ? 'border-ember text-ember' : 'border-border text-muted-foreground'
          }`}>
            {roleLabel}
          </span>
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-label="Band options"
              aria-expanded={menuOpen}
              onClick={e => { e.stopPropagation(); setMenuOpen(m => !m) }}
              className="size-7 border border-border bg-background grid place-items-center text-muted-foreground hover:border-ember hover:text-ember transition-colors"
            >
              <DotsVIcon />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[168px] border border-border bg-popover shadow-2xl py-1">
                <DropItem label="Open band" onClick={() => { setMenuOpen(false); onNavigate() }} />
                <div className="h-px bg-border my-1" />
                {isOwner
                  ? <DropItem label="Delete band" danger onClick={() => { setMenuOpen(false); onDelete() }} />
                  : <DropItem label="Leave band" danger onClick={() => { setMenuOpen(false); onLeave() }} />
                }
              </div>
            )}
          </div>
        </div>
      </div>

      <h3 className="font-display text-xl uppercase tracking-tight group-hover:text-ember transition-colors m-0">
        {band.name}
      </h3>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
        {band.projectCount} PROJECTS · {band.memberCount} MEMBERS · {formatRelative(band.lastUpdated)}
      </div>

      <div className="mt-5 space-y-3">
        {activityLine ? (
          <div className="text-[10px] text-muted-foreground line-clamp-1 border-l-2 border-ember/60 pl-2" title={activityLine}>
            {activityLine}
          </div>
        ) : (
          <div className="text-[10px] text-muted-foreground/50 line-clamp-1 border-l-2 border-border pl-2">
            No recent activity
          </div>
        )}
        <div>
          <div className="flex justify-between text-[9px] uppercase tracking-widest text-muted-foreground mb-1">
            <span>STORAGE</span>
            <span className="tabular-nums text-foreground">
              {formatBytes(band.storageBytes)} / {formatLimit(band.storageLimitBytes)}
            </span>
          </div>
          <div className="h-1 bg-surface-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${storagePct > 0.9 ? 'bg-destructive' : 'bg-ember'}`}
              style={{ width: `${Math.min(storagePct * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>
    </article>
  )
}

function DropItem({ label, danger, onClick }: {
  label: string; danger?: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full text-left px-3 py-2 text-[10px] uppercase tracking-widest transition-colors hover:bg-surface ${
        danger ? 'text-destructive' : 'text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

function DotsVIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="4" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="12" r="1.2" fill="currentColor" />
    </svg>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter()
  const { user, profile, loading: authLoading, updateOnboarding } = useAuth()
  const searchRef = useRef<HTMLInputElement>(null)

  const [bands, setBands] = useState<DashboardBand[]>([])
  const [totalBands, setTotalBands] = useState(0)
  const [totalProjects, setTotalProjects] = useState(0)
  const [totalCollaborators, setTotalCollaborators] = useState(0)
  const [loadingData, setLoadingData] = useState(true)

  const [filter, setFilter] = useState<FilterTab>('all')
  const [search, setSearch] = useState('')

  const [showNewBand, setShowNewBand] = useState(false)
  const [deletingBand, setDeletingBand] = useState<DashboardBand | null>(null)
  const [leavingBand, setLeavingBand] = useState<DashboardBand | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [showWelcomeDismissed, setShowWelcomeDismissed] = useState(false)
  const showWelcome =
    !showWelcomeDismissed &&
    !authLoading &&
    !!profile &&
    !profile.onboarding?.dashboard_seen

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth')
  }, [authLoading, user, router])

  useEffect(() => {
    if (authLoading || !user) return
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(data => {
        setBands(data.bands ?? [])
        setTotalBands(data.totalBands ?? 0)
        setTotalProjects(data.totalProjects ?? 0)
        setTotalCollaborators(data.totalCollaborators ?? 0)
      })
      .finally(() => setLoadingData(false))
  }, [authLoading, user])

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  function showToastMsg(msg: string) {
    setToast(msg); setTimeout(() => setToast(null), 3000)
  }

  const filteredBands = bands
    .filter(b => {
      if (filter === 'owner') return b.userRole === 'owner'
      if (filter === 'member') return b.userRole === 'member'
      return true
    })
    .filter(b => !search || b.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const aAct = a.latestActivity?.created_at ?? a.lastUpdated
      const bAct = b.latestActivity?.created_at ?? b.lastUpdated
      return bAct.localeCompare(aAct)
    })

  const totalStorageBytes = bands.reduce((s, b) => s + b.storageBytes, 0)

  if (authLoading) return <BrandSpinner />

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <AppHeader crumbs={<span className="text-foreground">Dashboard</span>} />

      {/* Hero */}
      <section className="border-b border-border bg-surface/40">
        <div className="mx-auto max-w-7xl px-6 py-10 grid lg:grid-cols-[1fr_auto] gap-8 items-end">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-ember font-bold mb-2">/ HOME BASE</div>
            <h1 className="font-display text-4xl sm:text-6xl uppercase tracking-tighter m-0 leading-none">
              {timeGreeting()},{' '}
              <span className="text-ember">{displayName(profile?.username)}</span>
            </h1>
            <p className="text-sm text-muted-foreground mt-3 max-w-md m-0">
              {totalBands} band{totalBands !== 1 ? 's' : ''}. {totalProjects} project{totalProjects !== 1 ? 's' : ''} in flight.
              {totalCollaborators > 0 && (
                <> {totalCollaborators} collaborator{totalCollaborators !== 1 ? 's' : ''} across your roster.</>
              )}
              {' '}Open one to keep going, or spin up a new one.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-px bg-border border border-border shrink-0">
            {[
              [totalBands, 'BANDS'],
              [totalProjects, 'PROJECTS'],
              [totalCollaborators, 'COLLABORATORS'],
            ].map(([n, l]) => (
              <div key={l as string} className="bg-background px-6 py-4 min-w-[7rem]">
                <div className="font-display text-3xl text-foreground tabular-nums leading-none">{n}</div>
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground mt-1">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Search + filters + new band */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-7xl px-6 py-4 flex flex-col lg:flex-row gap-4 items-stretch lg:items-center">
          <div className="flex-1 flex items-center border border-border bg-surface/60 px-3 h-10 focus-within:border-ember transition-colors">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground mr-3 shrink-0">SEARCH</span>
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Find a band…"
              className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground/60 outline-none text-foreground min-w-0"
            />
            <kbd className="hidden sm:inline text-[10px] uppercase tracking-widest text-muted-foreground/60 ml-2 shrink-0 border border-border px-1.5 py-0.5 bg-background">
              ⌘K
            </kbd>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex">
              {FILTER_TABS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={`px-4 h-10 text-[10px] uppercase tracking-widest border border-border -ml-px first:ml-0 transition-colors whitespace-nowrap ${
                    filter === id
                      ? 'bg-ember text-white border-ember z-[1] relative'
                      : 'bg-background text-foreground hover:border-ember hover:text-ember'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <TbButton variant="primary" onClick={() => setShowNewBand(true)} className="h-10 px-4 shrink-0">
              + New band
            </TbButton>
          </div>
        </div>
      </section>

      {/* Band grid */}
      <section className="mx-auto max-w-7xl px-6 py-10 flex-1 w-full">
        {loadingData ? (
          <div className="py-20 flex justify-center">
            <BrandSpinner fullscreen={false} />
          </div>
        ) : bands.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center border border-border bg-surface/30 px-6">
            <div className="font-display text-2xl uppercase tracking-tight text-muted-foreground">No bands yet</div>
            <p className="text-sm text-muted-foreground max-w-sm m-0">
              Create your first band or join one with an invite link
            </p>
            <div className="flex flex-wrap gap-3 justify-center mt-2">
              <TbButton variant="primary" onClick={() => setShowNewBand(true)} className="px-4 py-2">
                Create a band
              </TbButton>
              <TbButton onClick={() => router.push('/onboarding')} className="px-4 py-2">
                Join with invite link
              </TbButton>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <SectionLabel>{filteredBands.length} ACTIVE COLLECTIVE{filteredBands.length !== 1 ? 'S' : ''}</SectionLabel>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">SORT: RECENT ↓</div>
            </div>

            {filteredBands.length === 0 && search ? (
              <div className="py-16 text-center text-sm text-muted-foreground border border-border">
                No bands matching &ldquo;{search}&rdquo;
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border border border-border">
                {filteredBands.map((band, i) => (
                  <BandCard
                    key={band.id}
                    band={band}
                    index={i}
                    onNavigate={() => router.push(`/band/${band.id}`)}
                    onDelete={() => setDeletingBand(band)}
                    onLeave={() => setLeavingBand(band)}
                  />
                ))}

                {filter === 'all' && !search && (
                  <button
                    type="button"
                    onClick={() => setShowNewBand(true)}
                    className="bg-background p-5 flex flex-col items-center justify-center gap-3 text-muted-foreground hover:text-ember hover:bg-surface transition-colors min-h-[200px]"
                  >
                    <div className="size-12 border border-dashed border-border grid place-items-center text-2xl font-light group-hover:border-ember">+</div>
                    <div className="font-display text-sm uppercase tracking-widest">Create new band</div>
                    <div className="text-[10px] text-muted-foreground">or paste an invite code</div>
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <StatusFooter
        left={
          <span className="uppercase tracking-widest truncate">
            {totalBands} BANDS · {totalProjects} PROJECTS · {formatBytes(totalStorageBytes)} USED
          </span>
        }
      />

      {showNewBand && (
        <NewBandModal
          onClose={() => setShowNewBand(false)}
          onCreated={id => { setShowNewBand(false); router.push(`/band/${id}`) }}
        />
      )}
      {deletingBand && (
        <DeleteBandModal
          band={deletingBand}
          onClose={() => setDeletingBand(null)}
          onDeleted={() => {
            const name = deletingBand.name
            setBands(prev => prev.filter(b => b.id !== deletingBand.id))
            setTotalBands(n => n - 1)
            setDeletingBand(null)
            showToastMsg(`${name} has been deleted`)
          }}
        />
      )}
      {leavingBand && (
        <LeaveBandModal
          band={leavingBand}
          onClose={() => setLeavingBand(null)}
          onLeft={() => {
            setBands(prev => prev.filter(b => b.id !== leavingBand.id))
            setTotalBands(n => n - 1)
            setLeavingBand(null)
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-9000 border border-border bg-popover px-4 py-2.5 text-[10px] uppercase tracking-widest text-foreground shadow-2xl flex items-center gap-2 pointer-events-none">
          <span className="text-online">✓</span>{toast}
        </div>
      )}

      {showWelcome && (
        <DashboardWelcomeModal
          onDismiss={() => {
            setShowWelcomeDismissed(true)
            updateOnboarding('dashboard_seen', true)
          }}
        />
      )}
    </div>
  )
}
