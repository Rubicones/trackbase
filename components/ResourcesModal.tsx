'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { SectionLabel } from '@/components/design/AppShell'
import { ResourcesCard } from '@/components/ResourcesCard'

function IconFile({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ResourcesModal({
  open,
  onClose,
  projectId,
  projectName,
  storageFull = false,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  projectName: string
  storageFull?: boolean
}) {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  const handleClose = useCallback(() => onClose(), [onClose])

  useEffect(() => {
    if (open) {
      setMounted(true)
      document.body.style.overflow = 'hidden'
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true))
      })
      return () => { document.body.style.overflow = '' }
    }

    setVisible(false)
    const t = setTimeout(() => {
      setMounted(false)
      document.body.style.overflow = ''
    }, 200)
    return () => {
      clearTimeout(t)
      document.body.style.overflow = ''
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, handleClose])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[8000] flex items-center justify-center p-4"
      onClick={handleClose}
      role="presentation"
    >
      <div
        className={`absolute inset-0 bg-background/70 backdrop-blur-sm transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Project resources"
        onClick={e => e.stopPropagation()}
        className={`relative flex max-h-[min(85vh,720px)] w-full max-w-xl flex-col border border-border bg-background shadow-2xl transition-all duration-200 ${
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.98]'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0 pr-3">
            <SectionLabel>RESOURCES</SectionLabel>
            <div className="font-display mt-0.5 truncate text-lg uppercase tracking-tight text-foreground">
              {projectName}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="shrink-0 border-0 bg-transparent p-1 text-muted-foreground transition-colors hover:text-foreground cursor-pointer text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 min-h-0">
          <ResourcesCard
            projectId={projectId}
            projectName={projectName}
            bare
            variant="drawer"
            storageFull={storageFull}
          />
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function ProjectResourcesButton({
  projectId,
  projectName,
  storageFull = false,
  className = '',
}: {
  projectId: string
  projectName: string
  storageFull?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        data-tour="resources-card"
        onClick={() => setOpen(true)}
        className={`w-full flex items-center justify-center gap-2 border border-border text-[10px] uppercase tracking-widest text-muted-foreground hover:border-ember hover:text-ember px-3 py-2 transition bg-transparent cursor-pointer ${className}`}
      >
        <IconFile />
        Resources
      </button>
      <ResourcesModal
        open={open}
        onClose={() => setOpen(false)}
        projectId={projectId}
        projectName={projectName}
        storageFull={storageFull}
      />
    </>
  )
}
