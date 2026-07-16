'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { avatarInitials } from '@/lib/avatarTheme'
import { DESIGN_THEMES, useDesignTheme } from '@/lib/design-theme'
import { UserAvatar } from '@/components/ui/avatar'
import { ThemePicker } from '@/components/design/ThemePicker'
import { TbMenuButton } from '@/components/design/TbButton'
import { PreferencesModal } from '@/components/PreferencesModal'

function ThemeSwatches({ colors, size = 10 }: { colors: string[]; size?: number }) {
  return (
    <span className="flex gap-px shrink-0" aria-hidden>
      {colors.map((c, i) => (
        <span
          key={i}
          className="border border-border/50"
          style={{ width: size, height: size, background: c }}
        />
      ))}
    </span>
  )
}

export function AvatarDropdown() {
  const { profile } = useAuth()
  const { theme } = useDesignTheme()
  const [open, setOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false)
        setThemeOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!profile) return null

  const triggerInitials = avatarInitials(profile.username, 'user')
  const currentTheme = DESIGN_THEMES.find(t => t.id === theme) ?? DESIGN_THEMES[0]

  return (
    <>
      <div ref={dropRef} className="relative font-mono">
        <button
          type="button"
          aria-label="Account menu"
          aria-expanded={open}
          onClick={() => {
            setOpen(o => !o)
            if (open) setThemeOpen(false)
          }}
          className="size-8 border border-border bg-surface-2 grid place-items-center text-[10px] font-bold uppercase hover:border-lime transition-colors"
        >
          {triggerInitials}
        </button>

        {open && (
          <div className="absolute right-0 top-[calc(100%+8px)] z-100 w-[280px] border border-border bg-popover shadow-2xl">
            <div className="px-3 py-2 border-b border-border">
              <div className="flex items-center gap-2 min-w-0">
                <UserAvatar seed={profile.username} size={24} kind="user" />
                <p className="text-[11px] text-foreground m-0 truncate">
                  @{profile.username}
                </p>
              </div>
            </div>

            <div className="flex flex-col overflow-hidden">
              <TbMenuButton
                className="gap-2.5"
                onClick={() => {
                  setOpen(false)
                  setThemeOpen(false)
                  setPrefsOpen(true)
                }}
              >
                <span className="text-muted-foreground shrink-0"><PrefsIcon /></span>
                Preferences
              </TbMenuButton>

              <TbMenuButton
                active={themeOpen}
                className="gap-2.5"
                aria-expanded={themeOpen}
                onClick={() => setThemeOpen(o => !o)}
              >
                <span className="text-muted-foreground shrink-0"><ThemeIcon /></span>
                <span className="flex-1 min-w-0">Theme</span>
                <ThemeSwatches colors={currentTheme.swatches} size={9} />
                <span
                  className={`text-muted-foreground shrink-0 transition-transform duration-150 ${themeOpen ? 'rotate-180' : ''}`}
                  aria-hidden
                >
                  <ChevronIcon />
                </span>
              </TbMenuButton>
            </div>

            {themeOpen && (
              <div className="border-t border-border max-h-[300px] overflow-y-auto">
                <ThemePicker />
              </div>
            )}
          </div>
        )}
      </div>

      {prefsOpen && <PreferencesModal onClose={() => setPrefsOpen(false)} />}
    </>
  )
}

function PrefsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1" />
      <path
        d="M7 1.5v1.2M7 11.3V12.5M1.5 7h1.2M11.3 7H12.5M2.9 2.9l.85.85M10.25 10.25l.85.85M2.9 11.1l.85-.85M10.25 3.75l.85-.85"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ThemeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1" />
      <path d="M7 2a5 5 0 0 1 0 10V2z" fill="currentColor" opacity="0.35" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
