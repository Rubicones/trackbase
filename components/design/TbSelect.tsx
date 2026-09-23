'use client'

/**
 * The app's dropdown, as a generic control.
 *
 * The idiom already existed twice — `VersionToolbarDropdown` for the version
 * switcher and `FloatingPopover` behind the chat composer's context pickers —
 * but only ever bound to its own data. A native `<select>` is the thing this
 * replaces: it inherits none of the app's tokens, paints its menu with the
 * platform's own chrome, and on macOS ignores the border and radius entirely,
 * so one appearing among these controls reads as a browser artifact.
 *
 * Mechanics are `VersionToolbarDropdown`'s, unchanged: measure the trigger,
 * portal the menu to `<body>` so no ancestor's `overflow` can clip it, and
 * re-measure on resize and on scroll in any container (hence the capture
 * listener).
 *
 * ⚠ `VersionToolbarDropdown` still carries its own copy of all of this. It has
 * per-option state this cannot express yet (merged and blocked versions), so it
 * was left alone rather than half-migrated — but the two must not drift. If you
 * change the trigger or menu chrome here, change it there.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

export interface TbSelectOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

/** Shared chrome, so the trigger and its options cannot style apart. */
const OPTION_BASE =
  'shrink-0 text-[10px] uppercase tracking-widest px-2.5 py-1.5 border transition whitespace-nowrap text-left'

const OPTION_IDLE = 'border-border text-muted-foreground hover:border-lime hover:text-lime'
const OPTION_ACTIVE = 'bg-lime text-primary-foreground border-lime'
const OPTION_DISABLED = 'border-border text-muted-foreground opacity-40 cursor-not-allowed'

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      className={`shrink-0 opacity-90 transition-transform ${open ? 'rotate-180' : ''}`}
      aria-hidden
    >
      <path
        d="M2 3.5L5 6.5L8 3.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

export function TbSelect({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  className = '',
  placeholder = 'Select…',
}: {
  value: string
  options: TbSelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  disabled?: boolean
  /** Applied to the trigger, for width and height at the call site. */
  className?: string
  placeholder?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ left: number; top: number; minWidth: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const active = options.find(o => o.value === value)

  const reposition = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setCoords({ left: r.left, top: r.bottom + 4, minWidth: r.width })
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
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', reposition)
    // Capture, because the trigger may sit inside any scrolling container.
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [open, reposition])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`${OPTION_BASE} ${
          disabled ? OPTION_DISABLED : OPTION_IDLE
        } inline-flex items-center justify-between gap-2 ${className}`}
      >
        <span className="min-w-0 truncate">{active?.label ?? placeholder}</span>
        <Chevron open={open} />
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={ariaLabel}
            className="fixed z-[6000] flex max-h-64 flex-col gap-1 overflow-y-auto border border-border bg-background p-1 shadow-2xl scrollbar-none [&::-webkit-scrollbar]:hidden"
            style={{ left: coords.left, top: coords.top, minWidth: coords.minWidth }}
          >
            {options.map(option => {
              const isActive = option.value === value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  disabled={option.disabled}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                  className={`${OPTION_BASE} ${
                    option.disabled ? OPTION_DISABLED : isActive ? OPTION_ACTIVE : OPTION_IDLE
                  } flex items-center`}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                </button>
              )
            })}
          </div>,
          document.body,
        )}
    </>
  )
}
