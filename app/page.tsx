'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [bpm, setBpm] = useState('')
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          bpm: bpm ? parseInt(bpm) : undefined,
          key: key || undefined,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const { project } = await res.json()
      router.push(`/projects/${project.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        padding: '2rem',
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '0.5rem',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" fill="var(--accent)" opacity="0.15" />
              <path
                d="M8 6v4M8 14v4M16 6v4M16 14v4M8 10h2a2 2 0 0 1 2 2v0a2 2 0 0 0 2 2h2"
                stroke="var(--accent)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <span
              style={{
                fontSize: '1.125rem',
                fontWeight: 500,
                letterSpacing: '-0.02em',
              }}
            >
              Trackbase
            </span>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Git-like versioning for music demos
          </p>
        </div>

        {/* Form */}
        <form
          onSubmit={handleCreate}
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <div>
            <label style={labelStyle}>Project name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Summer EP, Track 3..."
              required
              style={inputStyle}
              autoFocus
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={labelStyle}>BPM</label>
              <input
                value={bpm}
                onChange={(e) => setBpm(e.target.value)}
                placeholder="120"
                type="number"
                min="40"
                max="300"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Key</label>
              <input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="C minor"
                style={inputStyle}
              />
            </div>
          </div>

          {error && (
            <p style={{ color: '#f87171', fontSize: '0.8125rem' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !name.trim()}
            style={{
              background: loading || !name.trim() ? '#2a2a3a' : 'var(--accent)',
              color: loading || !name.trim() ? 'var(--text-muted)' : '#fff',
              border: 'none',
              borderRadius: '8px',
              padding: '0.625rem 1rem',
              fontWeight: 500,
              cursor: loading || !name.trim() ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s',
            }}
          >
            {loading ? 'Creating…' : 'Create project →'}
          </button>
        </form>
      </div>
    </main>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '0.375rem',
  fontSize: '0.75rem',
  fontWeight: 500,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  padding: '0.5rem 0.75rem',
  color: 'var(--text)',
  fontSize: '0.875rem',
  outline: 'none',
}
