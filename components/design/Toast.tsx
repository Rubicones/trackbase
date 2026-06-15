'use client'

import { createPortal } from 'react-dom'

/** Brutalist toast — matches dashboard / uikit overlays. */
export function Toast({ message }: { message: string }) {
  return createPortal(
    <div
      role="status"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9000] border border-border bg-popover px-4 py-2.5 text-[10px] uppercase tracking-widest text-foreground shadow-2xl flex items-center gap-2 pointer-events-none animate-slide-in"
    >
      <span className="text-online shrink-0" aria-hidden>✓</span>
      <span>{message}</span>
    </div>,
    document.body,
  )
}
