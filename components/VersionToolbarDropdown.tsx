'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Version } from '@/lib/types'
import { VersionListName } from '@/components/VersionListName'

export function versionTabButtonClass(
  v: Version,
  isActive: boolean,
  switchBlocked: boolean,
): string {
  return `shrink-0 text-[10px] uppercase tracking-widest px-2.5 py-1.5 border transition whitespace-nowrap ${
    isActive
      ? 'bg-lime text-primary-foreground border-lime'
      : switchBlocked
        ? 'border-border text-muted-foreground opacity-40 cursor-not-allowed'
        : v.merged_at
          ? 'border-border text-muted-foreground opacity-50'
          : 'border-border hover:border-lime hover:text-lime text-muted-foreground'
  }`
}

function VersionTabLabel({ v, variant = 'trigger' }: { v: Version; variant?: 'trigger' | 'menu' }) {
  const prefix =
    v.type === 'main' ? '● ' : v.merged_at ? '✓ ' : v.type === 'branch' ? '⌥ ' : ''
  if (variant === 'menu') {
    return (
      <span className="line-clamp-2 w-[25ch] whitespace-normal wrap-break-word text-left">
        {prefix}
        <VersionListName version={v} />
      </span>
    )
  }
  return (
    <span className="min-w-0 truncate">
      {prefix}
      <VersionListName version={v} />
    </span>
  )
}

export function VersionToolbarDropdown({
  versions,
  activeId,
  onSelect,
  versionSwitchDisabled = false,
}: {
  versions: Version[]
  activeId: string
  onSelect: (id: string) => void
  versionSwitchDisabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ left: number; top: number; minWidth: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const active = versions.find(v => v.id === activeId)

  const reposition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setCoords({
      left: r.left + r.width / 2,
      top: r.bottom + 4,
      minWidth: r.width,
    })
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    reposition()
  }, [open, reposition])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return
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

  if (!active) return null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`${versionTabButtonClass(active, true, false)} inline-flex max-w-[180px] items-center gap-1.5`}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <VersionTabLabel v={active} />
        <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0 opacity-90" aria-hidden>
          <path
            d="M2 3.5L5 6.5L8 3.5"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </button>
      {open && coords && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          className="fixed z-[6000] flex flex-col gap-1 p-1 border border-border bg-background shadow-2xl max-h-64 overflow-y-auto scrollbar-none [&::-webkit-scrollbar]:hidden"
          style={{
            left: coords.left,
            top: coords.top,
            minWidth: coords.minWidth,
            transform: 'translateX(-50%)',
          }}
        >
          {versions.map(v => {
            const isActive = v.id === activeId
            const switchBlocked = versionSwitchDisabled && !isActive
            return (
              <button
                key={v.id}
                type="button"
                role="option"
                aria-selected={isActive}
                disabled={switchBlocked}
                onClick={() => {
                  onSelect(v.id)
                  setOpen(false)
                }}
                className={`${versionTabButtonClass(v, isActive, switchBlocked)} flex items-center`}
              >
                <VersionTabLabel v={v} variant="menu" />
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}
