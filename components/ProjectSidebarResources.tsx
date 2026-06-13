'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ProjectResource } from '@/lib/types'
import { ResourcesLyrics } from './ResourcesLyrics'

function IconLink({ size = 13, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconFile({ size = 13, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function resourceLabel(r: ProjectResource): string {
  if (r.type === 'file') return r.title ?? r.original_filename ?? 'File'
  if (r.type === 'link') return r.title ?? r.url ?? 'Link'
  return r.title ?? 'Resource'
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  fontSize: 13,
  color: 'var(--text-muted)',
  textDecoration: 'none',
  overflow: 'hidden',
  borderRadius: 8,
  transition: 'background 0.15s, color 0.15s',
}

function ResourceRow({
  href,
  label,
  type,
  external,
}: {
  href: string
  label: string
  type: 'file' | 'link'
  external?: boolean
}) {
  const iconColor = type === 'link' ? 'var(--accent)' : '#94a3b8'

  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className="block rounded-lg transition-colors duration-150"
      style={rowStyle}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--bg-card)'
        e.currentTarget.style.color = 'var(--text-sec)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--text-muted)'
      }}
      title={label}
    >
      {type === 'link' ? <IconLink color={iconColor} /> : <IconFile color={iconColor} />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </a>
  )
}

export function ProjectSidebarResources({
  projectId,
  projectName,
}: {
  projectId: string
  projectName: string
}) {
  const [resources, setResources] = useState<ProjectResource[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/resources`)
      if (!res.ok) return
      const data = await res.json()
      setResources((data.resources ?? []).filter((r: ProjectResource) => r.type !== 'notes'))
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { void load() }, [load])

  const lyrics = resources.find(r => r.type === 'lyrics') ?? null
  const attachments = resources.filter(r => r.type === 'file' || r.type === 'link')

  return (
    <div style={{ marginTop: 16 }}>
      <p
        className="text-[10px] font-medium uppercase px-[10px] mb-[10px]"
        style={{ color: 'var(--text-muted)', letterSpacing: '1px' }}
      >
        Resources
      </p>

      <ResourcesLyrics
        projectId={projectId}
        projectName={projectName}
        lyrics={lyrics}
        onUpdate={resource => {
          setResources(prev => {
            const without = prev.filter(r => r.type !== 'lyrics')
            return [...without, resource]
          })
        }}
        compact
      />

      {loading ? (
        <p style={{ fontSize: 10, color: 'var(--text-dim)', padding: '0 10px', margin: '8px 0 0' }}>
          Loading…
        </p>
      ) : attachments.length === 0 ? (
        <p style={{ fontSize: 10, color: 'var(--text-dim)', padding: '0 10px', margin: '8px 0 0' }}>
          No files or links yet
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
          {attachments.map(r => (
            <li key={r.id} style={{ marginBottom: 2 }}>
              {r.type === 'link' && r.url ? (
                <ResourceRow href={r.url} label={resourceLabel(r)} type="link" external />
              ) : (
                <ResourceRow
                  href={`/api/projects/${projectId}/resources/${r.id}/download`}
                  label={resourceLabel(r)}
                  type="file"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
