'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconBranch } from '@/components/chat/ContextIcons'
import { getVersionDisplayName } from '@/lib/versionSort'

export type VersionChipOption = {
  id: string
  name: string
  type?: 'main' | 'branch'
}

/** Renders a version name with the Archivo display font when it's the primary version. */
export function VersionNameLabel({
  version,
  className = '',
}: {
  version: { name: string; type?: 'main' | 'branch' }
  className?: string
}) {
  const name = getVersionDisplayName(version)
  const isMain = version.type === 'main'
  return (
    <span className={`${isMain ? 'font-display' : ''} ${className}`.trim()}>
      {name}
    </span>
  )
}

function ComposerChip({
  icon,
  label,
  active = false,
  chipRef,
  onClick,
  disabled,
  showPlus = false,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  chipRef?: React.RefObject<HTMLButtonElement | null>
  onClick: () => void
  disabled?: boolean
  showPlus?: boolean
}) {
  return (
    <button
      ref={chipRef}
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 border text-[9px] font-bold uppercase tracking-widest transition disabled:opacity-50 ${
        active
          ? 'border-lime bg-lime-soft text-lime'
          : 'border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground'
      }`}
    >
      {icon}
      {label}
      {showPlus && !active && (
        <span className="opacity-60">
          <svg width={10} height={10} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      )}
    </button>
  )
}

export function VersionChipSelector({
  versions,
  selectedId,
  onChange,
  disabled = false,
  popoverLabel = 'Version',
  showPlus = false,
}: {
  versions: VersionChipOption[]
  selectedId: string
  onChange: (id: string) => void
  disabled?: boolean
  popoverLabel?: string
  showPlus?: boolean
}) {
  const chipRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null)

  const selected = versions.find(v => v.id === selectedId)
  const label = selected ? getVersionDisplayName(selected) : 'Version'

  const reposition = useCallback(() => {
    const anchor = chipRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const popoverWidth = popoverRef.current?.offsetWidth ?? 224
    const popoverHeight = popoverRef.current?.offsetHeight ?? 220
    const gap = 8
    const spaceBelow = window.innerHeight - rect.bottom
    const above = spaceBelow < popoverHeight + gap && rect.top > popoverHeight + gap

    let left = rect.left
    if (left + popoverWidth > window.innerWidth - gap) {
      left = rect.right - popoverWidth
    }
    left = Math.max(gap, Math.min(left, window.innerWidth - popoverWidth - gap))

    let top = above ? rect.top - popoverHeight - 4 : rect.bottom + 4
    top = Math.max(gap, Math.min(top, window.innerHeight - popoverHeight - gap))

    setCoords({ left, top })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    reposition()
    const id = requestAnimationFrame(reposition)
    return () => cancelAnimationFrame(id)
  }, [open, reposition, versions.length])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (chipRef.current?.contains(t) || popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, reposition])

  return (
    <>
      <ComposerChip
        chipRef={chipRef}
        icon={<IconBranch />}
        label={label}
        active={!!selectedId}
        disabled={disabled}
        showPlus={showPlus}
        onClick={() => setOpen(o => !o)}
      />
      {open && coords && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[9001] w-56 max-h-64 overflow-y-auto scrollbar-none border border-border bg-surface-2 shadow-2xl"
          style={{ left: coords.left, top: coords.top }}
        >
          <div className="px-2 py-1.5 border-b border-border text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
            {popoverLabel}
          </div>
          {versions.map(v => (
            <button
              key={v.id}
              type="button"
              onClick={() => {
                onChange(v.id)
                setOpen(false)
              }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs transition ${
                v.id === selectedId ? 'bg-lime-soft text-lime' : 'hover:bg-surface'
              }`}
            >
              <span className="text-lime shrink-0"><IconBranch /></span>
              <VersionNameLabel version={v} className="truncate" />
              {v.type === 'main' && (
                <span className="ml-auto text-[8px] uppercase tracking-widest text-muted-foreground shrink-0">Master</span>
              )}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
