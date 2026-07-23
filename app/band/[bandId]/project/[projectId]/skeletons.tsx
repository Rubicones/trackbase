'use client'

// Loading skeletons for the mixer — extracted verbatim from page.tsx.
// NOTE: the original file also declared MobileLandscapeSkeleton, DesktopPageSkeleton
// and a ProjectPageSkeleton wrapper; all three were unreachable (only referenced by
// each other, never rendered) and were removed as dead code in this refactor.
import { SonicdeskWordmark } from '@/components/design/SonicdeskWordmark'
import { Skeleton } from '@/components/ui/Skeleton'
import { TRACK_LABEL_W, TRACK_ROW_H } from './mixerUtils'

// ─── Project page skeleton ────────────────────────────────────────────────────

export function TrackRowSkeleton() {
  return (
    <div className="flex border-b border-border" style={{ minHeight: TRACK_ROW_H }}>
      {/* Label column — mirrors the real TRACK_LABEL_W panel */}
      <div
        className="shrink-0 border-r border-border p-3 flex flex-col justify-between"
        style={{ width: TRACK_LABEL_W }}
      >
        <div className="flex items-center gap-2">
          <Skeleton width={20} height={20} borderRadius={2} className="shrink-0" />
          <div className="flex-1 min-w-0 space-y-1">
            <Skeleton width="75%" height={11} />
            <Skeleton width="50%" height={9} />
          </div>
        </div>
        {/* Real M / S buttons — disabled until loaded */}
        <div className="flex items-center gap-1 mt-2">
          <button
            disabled
            className="size-5 border border-border text-[9px] font-medium grid place-items-center text-muted-foreground opacity-40 cursor-not-allowed uppercase tracking-widest"
          >M</button>
          <button
            disabled
            className="size-5 border border-border text-[9px] font-medium grid place-items-center text-muted-foreground opacity-40 cursor-not-allowed uppercase tracking-widest"
          >S</button>
        </div>
      </div>
      {/* Waveform area */}
      <div className="flex-1 flex items-center px-3 min-w-0">
        <Skeleton width="100%" height={48} className="flex-1" />
      </div>
    </div>
  )
}

// ── Mobile portrait skeleton ──────────────────────────────────────────────────

export function MobilePortraitSkeleton() {
  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-background overflow-hidden">
      {/* Slim top bar — matches MobileExperience header */}
      <header className="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-border bg-background">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <SonicdeskWordmark href="/dashboard" className="text-sm" />
          <nav className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground min-w-0 overflow-hidden">
            <span className="shrink-0">Spaces</span>
            <span className="text-border shrink-0">/</span>
            <Skeleton width={60} height={10} className="shrink-0" />
            <span className="text-border shrink-0">/</span>
            <Skeleton width={80} height={10} />
          </nav>
        </div>
        {/* Avatar placeholder */}
        <Skeleton width={28} height={28} borderRadius="50%" className="shrink-0" />
      </header>

      {/* Mode switch bar — matches MobileExperience mode tabs */}
      <div className="px-3 pt-3 pb-2 border-b border-border bg-surface/40 shrink-0 space-y-2">
        <div className="grid grid-cols-2 border border-border bg-background">
          <div className="py-2.5 bg-lime text-primary-foreground text-[10px] font-bold uppercase tracking-widest flex items-center justify-center">
            ● Rehearsal
          </div>
          <div className="py-2.5 text-muted-foreground text-[10px] font-bold uppercase tracking-widest flex items-center justify-center">
            ≡ Mixer
          </div>
        </div>
      </div>

      {/* Rehearsal content skeleton */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Project header */}
        <div className="px-5 py-4 border-b border-border">
          <Skeleton width={100} height={10} className="mb-2" />
          <Skeleton width={220} height={30} className="mb-2" />
          <div className="flex gap-3">
            <Skeleton width={56} height={10} />
            <Skeleton width={36} height={10} />
            <Skeleton width={44} height={10} />
          </div>
        </div>

        {/* Waveform / progress bar */}
        <div className="px-5 py-4 border-b border-border">
          <Skeleton width="100%" height={56} className="mb-2" />
          <div className="flex justify-between">
            <Skeleton width={30} height={9} />
            <Skeleton width={30} height={9} />
          </div>
        </div>

        {/* Section cards */}
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="px-5 py-3 border-b border-border flex flex-col gap-2">
            <Skeleton width={80} height={10} />
            <div className="flex flex-wrap gap-2">
              {[40, 50, 45, 40].map((w, j) => (
                <Skeleton key={j} width={w} height={28} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Fixed player at bottom */}
      <div className="border-t border-border bg-surface/60 px-4 py-3 shrink-0 flex items-center gap-4">
        <Skeleton width={40} height={40} />
        <Skeleton width="100%" height={6} className="flex-1" />
        <Skeleton width={48} height={12} />
      </div>
    </div>
  )
}
