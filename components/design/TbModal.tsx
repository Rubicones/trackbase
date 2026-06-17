'use client'

import { createPortal } from 'react-dom'
import { useEffect, useState, type ReactNode } from 'react'

export function TbModal({
  children,
  onClose,
  wide = false,
  className = '',
}: {
  children: ReactNode
  onClose: () => void
  wide?: boolean
  className?: string
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[8000] flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className={`w-full ${wide ? 'max-w-[440px]' : 'max-w-md'} border border-border bg-popover p-6 shadow-2xl ${className}`}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
