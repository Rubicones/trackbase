'use client'

// New-version + delete-version modals — extracted verbatim from page.tsx.
import { useState } from 'react'
import { useTheme } from 'next-themes'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { TbBtn } from './mixerChrome'
import { CUSTOM_TAG_COLORS, versionTagStyle } from './mixerUtils'

// ─── New branch modal ─────────────────────────────────────────────────────────

export const NEW_VERSION_TAG_OPTIONS = [
  { value: 'experiment',  label: 'EXPERIMENT',  hint: 'Trying a new idea'        },
  { value: 'fix',         label: 'FIX',         hint: 'Re-recording / correcting' },
  { value: 'arrangement', label: 'ARRANGEMENT', hint: 'Changing song structure'  },
  { value: 'mix',         label: 'MIX',         hint: 'Levels, balance, processing' },
  { value: 'feature',     label: 'FEATURE',     hint: 'Adding something new'     },
  { value: 'custom',      label: 'CUSTOM',      hint: 'Enter your own label'     },
] as const

export function NewBranchModal({ onConfirm, onCancel }: { onConfirm: (n: string, tag: string | null) => void; onCancel: () => void }) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'
  const [step, setStep] = useState<'name' | 'tag'>('name')
  const [name, setName] = useState('')
  useBodyScrollLock(true)
  const [nameError, setNameError] = useState('')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [customTag, setCustomTag] = useState('')

  function validateName(value: string): boolean {
    if (value.trim().toLowerCase() === 'master') {
      setNameError('"Master" is reserved for the primary version. Try "Master 2" or another name.')
      return false
    }
    setNameError('')
    return true
  }

  function advanceToTag() {
    if (!name.trim()) return
    if (!validateName(name)) return
    setStep('tag')
  }

  function handleCreate(skipTag = false) {
    if (!name.trim()) return
    let tag: string | null = null
    if (!skipTag && selectedTag) {
      tag = selectedTag === 'custom' ? (customTag.trim().slice(0, 20) || null) : selectedTag
    }
    onConfirm(name.trim(), tag)
  }

  return (
    <div className="fixed inset-0 z-[8000] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm border border-border bg-popover p-6 shadow-2xl">
        {step === 'name' ? (
          <>
            <p className="font-display text-lg uppercase tracking-tight text-foreground mb-4 m-0">New version</p>
            <input
              autoFocus value={name}
              onChange={e => { setName(e.target.value); if (nameError) validateName(e.target.value) }}
              onKeyDown={e => { if (e.key === 'Enter' && name.trim()) advanceToTag(); if (e.key === 'Escape') onCancel() }}
              placeholder="feature/new-guitar"
              className={`w-full bg-background border px-3 py-2 text-sm text-foreground outline-none focus:border-lime placeholder:text-muted-foreground/60 mb-1 ${nameError ? 'border-red-500' : 'border-border'}`}
            />
            {nameError && (
              <p className="text-[10px] text-red-500 mb-3">{nameError}</p>
            )}
            {!nameError && <div className="mb-3" />}
            <div className="flex gap-2 justify-end">
              <TbBtn onClick={onCancel}>Cancel</TbBtn>
              <TbBtn variant="primary" onClick={advanceToTag} disabled={!name.trim()}>Next →</TbBtn>
            </div>
          </>
        ) : (
          <>
            <p className="font-display text-lg uppercase tracking-tight text-foreground m-0">{name}</p>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1 mb-4">What&apos;s this version for? <span className="normal-case tracking-normal">(optional)</span></p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {NEW_VERSION_TAG_OPTIONS.map(opt => {
                const ts = opt.value === 'custom'
                  ? { label: 'CUSTOM', bg: isDark ? CUSTOM_TAG_COLORS.darkBg : CUSTOM_TAG_COLORS.bg }
                  : versionTagStyle(opt.value, isDark)
                const isSelected = selectedTag === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedTag(s => s === opt.value ? null : opt.value)}
                    className={`text-left px-3 py-2 border text-[10px] uppercase tracking-widest transition ${
                      isSelected
                        ? 'border-transparent'
                        : 'border-border text-muted-foreground hover:border-foreground/40'
                    }`}
                    style={isSelected ? { background: ts?.bg, color: '#fff', borderColor: 'transparent' } : {}}
                  >
                    <span className="flex items-center gap-2">
                      {!isSelected && (
                        <span className="shrink-0 inline-block" style={{ width: 8, height: 8, borderRadius: 0, background: ts?.bg }} />
                      )}
                      <span className="font-bold">{opt.label}</span>
                    </span>
                    <span className={`block normal-case tracking-normal text-[9px] mt-0.5 ${isSelected ? 'opacity-80' : 'opacity-60'}`}>{opt.hint}</span>
                  </button>
                )
              })}
            </div>
            {selectedTag === 'custom' && (
              <input
                autoFocus
                value={customTag}
                onChange={e => setCustomTag(e.target.value.slice(0, 20))}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setSelectedTag(null) }}
                placeholder="e.g. vocals-rewrite"
                maxLength={20}
                className="w-full bg-background border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-lime placeholder:text-muted-foreground/60 mb-4"
              />
            )}
            <div className="flex gap-2 justify-between">
              <TbBtn onClick={() => setStep('name')}>← Back</TbBtn>
              <div className="flex gap-2">
                <TbBtn onClick={() => handleCreate(true)}>Skip</TbBtn>
                <TbBtn variant="primary" onClick={() => handleCreate()}>Create</TbBtn>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Delete version modal ─────────────────────────────────────────────────────

export function DeleteVersionModal({
  name, deleting, onCancel, onConfirm,
}: {
  name: string
  deleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  useBodyScrollLock(true)
  return (
    <div
      className="fixed inset-0 z-[8000] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm border border-border bg-popover p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        onClick={e => e.stopPropagation()}
      >
        <p className="font-display text-lg uppercase tracking-tight text-foreground mb-3 m-0">
          Delete &ldquo;{name}&rdquo;?
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed m-0">
          This permanently deletes this version and its tracks, sections, and comments. This can&apos;t be undone.
        </p>
        <div className="flex gap-2 justify-end mt-6">
          <TbBtn onClick={onCancel} disabled={deleting}>Cancel</TbBtn>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="text-[10px] uppercase tracking-widest px-3 py-1.5 border border-destructive bg-destructive text-destructive-foreground font-display font-bold transition disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete version'}
          </button>
        </div>
      </div>
    </div>
  )
}
