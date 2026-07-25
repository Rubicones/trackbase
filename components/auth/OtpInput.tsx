'use client'

/**
 * Segmented one-time-code input — one box per digit.
 *
 * ## Why one real input instead of N inputs
 *
 * This renders ONE `<input maxlength={length}>` stretched invisibly across the
 * row, with the boxes drawn underneath as presentation only (`aria-hidden`).
 * The caret position and selection range are read back off that input to
 * decide which box looks active or selected.
 *
 * The N-separate-inputs version of this widget cannot satisfy the requirements:
 *
 * - **Selection across boxes.** Browsers do not extend a text selection across
 *   separate input elements, so "select the whole code and delete it" would
 *   have to be faked with custom state — and would still not respond to
 *   Cmd/Ctrl+A, shift+arrows, or a drag across the row.
 * - **Paste while focused on any box.** With one field there is only one place
 *   for a paste to land, so pasting from the 4th box is the same code path as
 *   pasting from the 1st.
 * - **Autofill.** `autocomplete="one-time-code"` (iOS/Safari, and Chrome's
 *   email/SMS code suggestion) fills a single field. Across N fields it
 *   typically drops the whole code into the first box or gives up.
 * - **Screen readers.** One labelled field is announced once, as
 *   "Verification code, edit text". N fields are announced as N unlabelled
 *   boxes and force the user to discover that arrowing between them is needed.
 *
 * Backspace-clears-and-steps-back and arrow-key navigation are then just the
 * input's native behaviour, so there is no keyboard handling to get subtly
 * wrong. The user-visible result is identical to the N-input version.
 *
 * ## Animation
 *
 * Each digit reveals with `animate-otp-digit-in` and, on delete, leaves with
 * `animate-otp-digit-out`. Those are the band/project card `animate-slide-in`
 * motion — same translateY-and-fade, same cubic-bezier(0.32, 0.72, 0, 1) — at
 * a distance and duration scaled to a single glyph. See the comment above the
 * keyframes in `app/design-system.css`.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { OTP_LENGTH, sanitizeOtp } from '@/lib/auth/otp'

/** Keep in sync with `tb-otp-digit-out` in app/design-system.css. */
const DIGIT_OUT_MS = 160

type Ghost = { index: number; char: string; key: number }

export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  invalid = false,
  autoFocus = false,
  label = 'Verification code',
  hint,
  length = OTP_LENGTH,
}: {
  value: string
  onChange: (value: string) => void
  /** Fired once per distinct full-length value (i.e. auto-submit). */
  onComplete?: (value: string) => void
  disabled?: boolean
  invalid?: boolean
  autoFocus?: boolean
  label?: string
  /** Rendered under the boxes and wired up as the field's description. */
  hint?: string
  length?: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const reactId = useId()
  const inputId = `otp-${reactId}`
  const hintId = `otp-hint-${reactId}`

  const [focused, setFocused] = useState(false)
  const [selection, setSelection] = useState({ start: 0, end: 0 })

  // Digits that have been removed but are still animating out. They overlay the
  // box they left, so a replaced digit cross-fades with its successor.
  //
  // Ghosts are spawned from the event handlers (via `commit`) rather than from
  // an effect watching `value`. That covers every deletion the user performs —
  // backspace, Delete, select-and-clear, overwrite-by-paste — without a
  // setState-inside-useEffect cascade. A parent-driven reset (clearing the
  // field after a rejected code) deliberately does not animate out: the whole
  // field is being reset and an error is appearing at the same time, so six
  // simultaneous exit animations would just be noise.
  const [ghosts, setGhosts] = useState<Ghost[]>([])
  const ghostKeyRef = useRef(0)
  const timersRef = useRef<number[]>([])

  useEffect(
    () => () => {
      timersRef.current.forEach(id => window.clearTimeout(id))
      timersRef.current = []
    },
    [],
  )

  function spawnGhosts(prev: string, next: string) {
    const removed: Ghost[] = []
    for (let i = 0; i < length; i++) {
      const before = prev[i]
      if (before && before !== next[i]) {
        removed.push({ index: i, char: before, key: ghostKeyRef.current++ })
      }
    }
    if (removed.length === 0) return

    setGhosts(current => [...current, ...removed])
    const keys = new Set(removed.map(g => g.key))
    const timer = window.setTimeout(() => {
      setGhosts(current => current.filter(g => !keys.has(g.key)))
      timersRef.current = timersRef.current.filter(id => id !== timer)
    }, DIGIT_OUT_MS)
    timersRef.current.push(timer)
  }

  const syncSelection = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    setSelection({ start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 })
  }, [])

  // Keep the painted caret in step after the value changes programmatically
  // (paste, autofill, parent-driven clear on a failed verify).
  useEffect(() => {
    syncSelection()
  }, [value, syncSelection])

  // Auto-submit, guarded so a re-render with the same full value cannot fire
  // a second verify request.
  const completedRef = useRef<string | null>(null)
  useEffect(() => {
    if (value.length < length) {
      completedRef.current = null
      return
    }
    if (completedRef.current === value) return
    completedRef.current = value
    onComplete?.(value)
  }, [value, length, onComplete])

  function commit(next: string, caret?: number) {
    spawnGhosts(value, next)
    onChange(next)
    const el = inputRef.current
    if (!el) return
    const pos = caret ?? next.length
    // The DOM value is written by React on the next commit; set the caret
    // after that so it is not clamped against the stale value.
    requestAnimationFrame(() => {
      if (inputRef.current === el) {
        el.setSelectionRange(pos, pos)
        syncSelection()
      }
    })
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const el = e.target
    const raw = el.value
    const clean = sanitizeOtp(raw, length)

    // Autofill and IME can deliver the whole code in one change event.
    if (clean === value) {
      syncSelection()
      return
    }
    // Preserve the caret the browser just computed when nothing was stripped,
    // so typing into the middle of the code behaves normally.
    const caret = raw === clean ? (el.selectionStart ?? clean.length) : clean.length
    commit(clean, Math.min(caret, clean.length))
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const digits = (e.clipboardData?.getData('text') ?? '').replace(/\D/g, '')
    if (!digits) return
    e.preventDefault()

    // A full-length paste replaces the whole code no matter which box the
    // caret is in — pasting "123456" from box 4 must not produce "123123".
    if (digits.length >= length) {
      commit(digits.slice(0, length))
      return
    }

    const el = inputRef.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? start
    const merged = sanitizeOtp(value.slice(0, start) + digits + value.slice(end), length)
    commit(merged, Math.min(start + digits.length, merged.length))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // Backspace, Delete, arrows, Home/End and shift-selection are all native
    // input behaviour and deliberately not intercepted.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      return
    }
    // Swallow printable non-digits so they never flash into the boxes.
    if (
      e.key.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !/\d/.test(e.key)
    ) {
      e.preventDefault()
    }
  }

  function handleFocus() {
    setFocused(true)
    const el = inputRef.current
    // Park the caret after the last digit when the code is incomplete; when it
    // is complete, respect wherever the user clicked.
    if (el && value.length < length) {
      const pos = value.length
      requestAnimationFrame(() => {
        if (inputRef.current === el) {
          el.setSelectionRange(pos, pos)
          syncSelection()
        }
      })
    } else {
      syncSelection()
    }
  }

  const hasRange = focused && selection.end > selection.start
  const caretIndex = focused && !hasRange ? Math.min(selection.start, length - 1) : -1

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={inputId}
        className="block text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground"
      >
        {label}
      </label>

      <div className={`relative ${disabled ? 'opacity-50' : ''}`}>
        <div className="flex gap-1.5 sm:gap-2" aria-hidden="true">
          {Array.from({ length }, (_, i) => {
            const char = value[i] ?? ''
            const selected = hasRange && i >= selection.start && i < selection.end
            const active = i === caretIndex
            const slotGhosts = ghosts.filter(g => g.index === i)

            const borderClass = invalid
              ? 'border-destructive'
              : selected
                ? 'border-lime bg-lime-soft/30'
                : active
                  ? 'border-lime'
                  : char
                    ? 'border-muted-foreground/40'
                    : 'border-border'

            return (
              <div
                key={i}
                className={[
                  'relative grid place-items-center overflow-hidden',
                  'h-12 flex-1 min-w-0 border-2 bg-background',
                  'font-mono text-lg text-foreground tabular-nums',
                  'transition-colors',
                  borderClass,
                ].join(' ')}
              >
                {char && (
                  <span
                    // Re-keying on the character remounts the span so the
                    // reveal replays when a digit is replaced in place.
                    key={`${i}-${char}`}
                    className="animate-otp-digit-in"
                  >
                    {char}
                  </span>
                )}

                {slotGhosts.map(ghost => (
                  <span
                    key={ghost.key}
                    className="absolute inset-0 grid place-items-center animate-otp-digit-out"
                  >
                    {ghost.char}
                  </span>
                ))}

                {active && !char && !disabled && (
                  <span className="absolute inset-y-3 w-0.5 bg-lime tb-blink" />
                )}
              </div>
            )
          })}
        </div>

        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          // Hints Safari/iOS and password managers; also keeps the field out
          // of spell-check and autocapitalise heuristics.
          pattern={`\\d{${length}}`}
          maxLength={length}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? hintId : undefined}
          onChange={handleChange}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          onKeyUp={syncSelection}
          onSelect={syncSelection}
          onClick={syncSelection}
          onFocus={handleFocus}
          onBlur={() => setFocused(false)}
          className={[
            'tb-otp-field absolute inset-0 h-full w-full',
            'border-0 bg-transparent p-0 text-center outline-none',
            'disabled:cursor-not-allowed',
          ].join(' ')}
        />
      </div>

      {hint && (
        <p id={hintId} className="m-0 text-[11px] leading-relaxed text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}
