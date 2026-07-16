'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'

export function MasterEditConfirmModal({
  onConfirm,
  onNewVersion,
  onCancel,
}: {
  onConfirm: (suppress24h: boolean) => void
  onNewVersion: (suppress24h: boolean) => void
  onCancel: () => void
}) {
  const [suppress24h, setSuppress24h] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])
  useBodyScrollLock(mounted)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[8500] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md border border-border bg-popover p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="master-edit-guard-title"
        onClick={e => e.stopPropagation()}
      >
        <p
          id="master-edit-guard-title"
          className="font-display text-lg uppercase tracking-tight text-foreground mb-3 m-0"
        >
          Edit Master?
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed m-0">
          Are you sure you want to edit the Master branch manually? You can&apos;t undo this action
          later. You can create a new version of the main branch instead.
        </p>

        <div className="flex flex-col gap-2 mt-6">
          <button
            type="button"
            onClick={() => onNewVersion(suppress24h)}
            className="w-full inline-flex items-center justify-center gap-1.5 bg-surface/40 text-[10px] uppercase tracking-widest px-3 py-1.5 border border-dashed border-border hover:border-lime hover:text-lime text-muted-foreground transition"
          >
            + New Version
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-widest px-3 py-1.5 border border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground transition"
            >
              Undo Changes
            </button>
            <button
              type="button"
              onClick={() => onConfirm(suppress24h)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-widest px-3 py-1.5 border border-lime bg-lime text-primary-foreground font-display font-bold transition"
            >
              I&apos;m sure
            </button>
          </div>
        </div>

        <button
          type="button"
          role="checkbox"
          aria-checked={suppress24h}
          onClick={() => setSuppress24h(v => !v)}
          className="flex items-center gap-2.5 mt-5 cursor-pointer select-none bg-transparent border-0 p-0 text-left"
        >
          <span
            className={`size-3 shrink-0 rounded-none border transition-colors ${
              suppress24h ? 'bg-lime border-lime' : 'bg-transparent border-border'
            }`}
            aria-hidden
          />
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
            Don&apos;t show again for 24h
          </span>
        </button>
      </div>
    </div>,
    document.body,
  )
}
