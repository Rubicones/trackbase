'use client'

import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'

interface Props {
  onDismiss: () => void
}

export function BandWelcomeModal({ onDismiss }: Props) {
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
          <MusicIcon />
        </div>

        {/* Title */}
        <p style={{ fontSize: 18, fontWeight: 500, color: 'var(--text)', margin: '0 0 10px' }}>
          Your band&rsquo;s dashboard
        </p>

        {/* Body */}
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.7, margin: '0 0 16px' }}>
          Here&rsquo;s where your band lives. You&rsquo;ll find:
        </p>

        <ul style={{ margin: '0 0 20px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[
            ['Projects', 'your songs and demos, each with full version history'],
            ['Members', 'everyone in the band, with their roles'],
            ['Activity', 'what\'s been happening recently'],
            ['Storage', 'how much space your band is using'],
          ].map(([label, desc]) => (
            <li key={label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6, fontSize: 14, color: 'var(--text-muted)' }}>
              <span style={{
                width: 4, height: 4, borderRadius: '50%',
                background: 'var(--accent)',
                flexShrink: 0,
                marginTop: 8,
              }} />
              <span><strong style={{ color: 'var(--text)', fontWeight: 500 }}>{label}</strong> — {desc}</span>
            </li>
          ))}
        </ul>

        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.7, margin: '0 0 24px' }}>
          Open a project to start uploading tracks, or create a new one.
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

function MusicIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  )
}
