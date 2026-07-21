'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ThumbsUp, ThumbsDown, Bug, Check, X, type IconNode } from 'lucide'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { trackEvent } from '@/lib/analytics'
import { LucideIcon } from '@/components/design/LucideIcon'

type CategoryId = 'positive' | 'negative' | 'bug'

interface CategoryDef {
  id: CategoryId
  label: string
  desc: string
  icon: IconNode
  /** CSS variable driving all per-category tinting. */
  color: string
  formLabel: string
  placeholder: string
  submit: string
  confTitle: string
  confBody: string
}

const CATEGORIES: CategoryDef[] = [
  {
    id: 'positive',
    label: 'Good feedback',
    desc: 'Something you love',
    icon: ThumbsUp,
    color: 'var(--online)',
    formLabel: "What's working well for you?",
    placeholder: 'Tell us what you enjoyed…',
    submit: 'Send feedback',
    confTitle: 'Thanks for the kind words',
    confBody:
      "We're glad it's working for you. Really appreciate you taking the time to say so.",
  },
  {
    id: 'negative',
    label: 'Bad feedback',
    desc: "Something that's not working for you",
    icon: ThumbsDown,
    color: 'var(--amber)',
    formLabel: "What's frustrating or missing?",
    placeholder: "Tell us what's not working the way you'd like…",
    submit: 'Send feedback',
    confTitle: 'Got it — thanks for telling us',
    confBody:
      "We read every one of these. We'll take a look and reach out if we need more details.",
  },
  {
    id: 'bug',
    label: 'Bug report',
    desc: 'Something broken or behaving wrong',
    icon: Bug,
    color: 'var(--destructive)',
    formLabel: 'What happened?',
    placeholder:
      'Steps to reproduce help a lot — what were you doing when it happened?',
    submit: 'Send bug report',
    confTitle: 'Bug reported',
    confBody:
      "We'll look into this and follow up if we need more details to track it down.",
  },
]

const MIN_LENGTH = 10
const MAX_LENGTH = 2000
const WARN_REMAINING = 100
const TEXTAREA_MAX_H = 220

export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [selectedId, setSelectedId] = useState<CategoryId | null>(null)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const selected = useMemo(
    () => CATEGORIES.find(c => c.id === selectedId) ?? null,
    [selectedId],
  )

  useBodyScrollLock(true)

  // Escape closes at any point — low-stakes, no unsaved-changes guard.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Auto-close once the confirmation has had a moment to land (matches the push
  // permission success behaviour — no explicit close button on success).
  useEffect(() => {
    if (!done) return
    const t = window.setTimeout(onClose, 2000)
    return () => window.clearTimeout(t)
  }, [done, onClose])

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_H)}px`
  }, [])

  const selectCategory = useCallback(
    (id: CategoryId) => {
      setSelectedId(id)
      setError('')
      // Move focus straight into the textarea so the user can start typing.
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus()
        resizeTextarea()
      })
    },
    [resizeTextarea],
  )

  const trimmedLength = message.trim().length
  const canSubmit = !!selected && trimmedLength >= MIN_LENGTH && !submitting
  const remaining = MAX_LENGTH - message.length
  const showWarning = remaining <= WARN_REMAINING

  const handleSubmit = useCallback(async () => {
    if (!selected || trimmedLength < MIN_LENGTH || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: selected.id,
          message: message.trim(),
          pageUrl: window.location.href,
        }),
      })
      if (!res.ok) throw new Error(`Request failed: ${res.status}`)
      trackEvent('feedback_submitted', { type: selected.id })
      setDone(true)
    } catch (err) {
      console.error('[feedback] submit failed:', err)
      setError('Something went wrong sending this. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }, [selected, trimmedLength, submitting, message])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[8000] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 overflow-y-auto overscroll-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl border border-border bg-popover shadow-2xl my-auto max-h-[calc(100dvh-2rem)] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-modal-title"
        onClick={e => e.stopPropagation()}
      >
        {/* Close button — top-right, matches other modals. */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <div className="min-w-0">
            <h2
              id="feedback-modal-title"
              className="m-0 font-display text-lg uppercase tracking-tight text-foreground"
            >
              {done ? 'Sent' : "What's this about?"}
            </h2>
            {!done && (
              <p className="m-0 mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">
                Pick one to get started
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="shrink-0 -mr-1.5 -mt-0.5 grid size-7 place-items-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <LucideIcon icon={X} size={18} />
          </button>
        </div>

        {done && selected ? (
          <ConfirmationView category={selected} />
        ) : (
          <div className="px-6 pb-6 pt-4">
            {/* ── Top zone: category selector ── */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {CATEGORIES.map(cat => (
                <CategoryCard
                  key={cat.id}
                  category={cat}
                  selected={selectedId === cat.id}
                  onSelect={() => selectCategory(cat.id)}
                />
              ))}
            </div>

            {/* ── Bottom zone: message form ── */}
            <div
              className={`mt-6 transition-all duration-300 ${
                selected
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-45 translate-y-1 pointer-events-none select-none'
              }`}
              aria-hidden={!selected}
            >
              <label
                htmlFor="feedback-message"
                className="block text-[11px] font-bold uppercase tracking-[0.18em] text-foreground"
              >
                {selected ? selected.formLabel : 'Tell us more'}
              </label>

              <div className="relative mt-2">
                <textarea
                  id="feedback-message"
                  ref={textareaRef}
                  value={message}
                  disabled={!selected}
                  maxLength={MAX_LENGTH}
                  rows={4}
                  onChange={e => {
                    setMessage(e.target.value)
                    resizeTextarea()
                  }}
                  placeholder={selected ? selected.placeholder : ''}
                  className="w-full resize-none border border-border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-lime disabled:cursor-not-allowed"
                  style={{ minHeight: '6.5rem', maxHeight: TEXTAREA_MAX_H }}
                />
                <span
                  className={`pointer-events-none absolute bottom-2 right-2.5 text-[10px] tabular-nums transition-colors ${
                    showWarning ? 'text-destructive' : 'text-muted-foreground/60'
                  }`}
                >
                  {message.length}/{MAX_LENGTH}
                </span>
              </div>

              <p className="m-0 mt-2 text-[11px] leading-relaxed text-muted-foreground">
                We&apos;ll include the page you&apos;re on and your account email
                automatically.
              </p>

              {error && (
                <p
                  role="alert"
                  className="m-0 mt-4 text-xs leading-relaxed text-destructive"
                >
                  {error}
                </p>
              )}

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={!canSubmit}
                  className="tb-btn-accent inline-flex min-w-[9.5rem] items-center justify-center gap-1.5 border border-lime bg-lime px-4 py-2 text-[11px] uppercase text-primary-foreground transition-opacity disabled:opacity-40 disabled:pointer-events-none"
                >
                  {submitting ? 'Sending…' : selected?.submit ?? 'Send feedback'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

function CategoryCard({
  category,
  selected,
  onSelect,
}: {
  category: CategoryDef
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group flex flex-col gap-2 border p-3.5 text-left transition-colors ${
        selected ? '' : 'border-border bg-surface hover:border-[var(--fb)]'
      }`}
      style={
        {
          '--fb': category.color,
          borderColor: selected ? category.color : undefined,
          background: selected
            ? `color-mix(in oklab, ${category.color} 9%, transparent)`
            : undefined,
        } as CSSProperties
      }
    >
      <span
        className="grid size-8 place-items-center border transition-colors"
        style={{
          borderColor: selected ? category.color : 'var(--border)',
          background: selected ? category.color : 'var(--surface-2)',
          color: selected ? 'var(--background)' : category.color,
        }}
      >
        <LucideIcon
          icon={category.icon}
          size={17}
          strokeWidth={selected ? 2.25 : 1.75}
        />
      </span>
      <span className="text-[13px] font-semibold leading-tight text-foreground">
        {category.label}
      </span>
      <span className="text-[11px] leading-snug text-muted-foreground">
        {category.desc}
      </span>
    </button>
  )
}

function ConfirmationView({ category }: { category: CategoryDef }) {
  return (
    <div
      className="flex flex-col items-center gap-3 px-6 pb-9 pt-6 text-center"
      role="status"
    >
      <span
        className="grid size-14 place-items-center rounded-full"
        style={{
          background: `color-mix(in oklab, ${category.color} 14%, transparent)`,
          color: category.color,
        }}
      >
        <LucideIcon icon={Check} size={30} strokeWidth={2.25} />
      </span>
      <h3 className="m-0 font-display text-base uppercase tracking-tight text-foreground">
        {category.confTitle}
      </h3>
      <p className="m-0 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {category.confBody}
      </p>
    </div>
  )
}
