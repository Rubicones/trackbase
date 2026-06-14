'use client'

import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'

interface Props {
  onDismiss: () => void
}

export function DashboardWelcomeModal({ onDismiss }: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 200, padding: 16,
      }}
    >
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '0.5px solid var(--border)',
          borderRadius: 'var(--border-radius-lg, 16px)',
          padding: 28,
          width: 440,
          maxWidth: 'calc(100vw - 32px)',
        }}
      >
        {/* Icon */}
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 16,
          color: 'var(--accent)',
        }}>
          <FoldersIcon />
        </div>

        {/* Title */}
        <p style={{ fontSize: 18, fontWeight: 500, color: 'var(--text)', margin: '0 0 10px' }}>
          Welcome to Trackbase
        </p>

        {/* Body */}
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 24px' }}>
          This is your bands page. Each band is a space for your group — projects, members, and
          activity all live here. Create a band to get started, or join one with an invite link.
        </p>

        {/* Footer */}
        <button
          onClick={onDismiss}
          style={{
            display: 'block', width: '100%',
            background: 'var(--accent)', border: 'none',
            borderRadius: 8, padding: '10px 0',
            color: 'var(--on-accent)', fontSize: 14, fontWeight: 500,
            cursor: 'pointer', transition: 'background 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-hover)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)' }}
        >
          Got it
        </button>
      </div>
    </div>,
    document.body,
  )
}

function FoldersIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3 11h18" strokeOpacity="0.4" />
    </svg>
  )
}
