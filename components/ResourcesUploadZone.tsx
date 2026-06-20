'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import type { ProjectResource } from '@/lib/types'

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconX({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

type UploadStatus = 'uploading' | 'processing' | 'done' | 'error'

interface UploadItem {
  id: string
  file: File
  title: string
  status: UploadStatus
  progress: number
  errorMessage?: string
}

export interface Props {
  projectId: string
  onUploadComplete: (resource: ProjectResource) => void
  variant?: 'default' | 'drawer'
  /** Hide the drag-and-drop field (file picker via ref still works). */
  hideDropZone?: boolean
}

export type ResourcesUploadZoneHandle = {
  openFilePicker: () => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _id = 0
const uid = () => `ru-${++_id}`

function stemName(filename: string) {
  return filename.replace(/\.[^.]+$/, '')
}

function fmtSize(b: number) {
  return b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`
}

function xhrPut(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.send(file)
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export const ResourcesUploadZone = forwardRef<ResourcesUploadZoneHandle, Props>(function ResourcesUploadZone(
  { projectId, onUploadComplete, hideDropZone = false },
  ref,
) {
  const [dragging, setDragging] = useState(false)
  const [queue, setQueue] = useState<UploadItem[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    openFilePicker: () => fileInputRef.current?.click(),
  }), [])

  function patch(id: string, update: Partial<UploadItem>) {
    setQueue(q => q.map(i => (i.id === id ? { ...i, ...update } : i)))
  }

  function remove(id: string) {
    setQueue(q => q.filter(i => i.id !== id))
  }

  async function runUpload(item: UploadItem) {
    try {
      // 1 — Presign
      const psRes = await fetch(`/api/projects/${projectId}/resources/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: item.file.name,
          fileSize: item.file.size,
          contentType: item.file.type || 'application/octet-stream',
        }),
      })
      if (!psRes.ok) {
        const { error } = await psRes.json().catch(() => ({}))
        throw new Error(error ?? 'Presign failed')
      }
      const { presignedUrl, tempKey } = await psRes.json()

      // 2 — Upload to R2
      await xhrPut(presignedUrl, item.file, pct => patch(item.id, { progress: pct }))

      // 3 — Process
      patch(item.id, { status: 'processing', progress: 100 })
      const procRes = await fetch(`/api/projects/${projectId}/resources/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tempKey,
          originalFilename: item.file.name,
          fileSize: item.file.size,
          mimetype: item.file.type || 'application/octet-stream',
          title: item.title.trim() || null,
        }),
      })
      if (!procRes.ok) {
        const { error } = await procRes.json().catch(() => ({}))
        throw new Error(error ?? 'Processing failed')
      }
      const { resource } = await procRes.json()
      patch(item.id, { status: 'done' })
      onUploadComplete(resource)
      setTimeout(() => remove(item.id), 1000)
    } catch (err) {
      patch(item.id, { status: 'error', errorMessage: err instanceof Error ? err.message : 'Upload failed' })
    }
  }

  function enqueue(files: FileList | File[]) {
    const items: UploadItem[] = Array.from(files).map(file => ({
      id: uid(),
      file,
      title: stemName(file.name),
      status: 'uploading',
      progress: 0,
    }))
    setQueue(q => [...q, ...items])
    items.forEach(item => runUpload(item))
  }

  return (
    <div>
      {!hideDropZone && (
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) enqueue(e.dataTransfer.files) }}
        className={`border border-dashed p-6 text-center text-xs text-muted-foreground cursor-pointer transition-colors ${
          dragging ? 'border-ember bg-ember-soft' : 'border-border hover:border-ember'
        }`}
      >
        <p className="m-0 leading-relaxed font-mono">
          Drag-and-drop WAV / MP3 / MIDI / PDF / DAW — max 200 MB
          {' · '}
          <span className="text-ember">browse</span>
        </p>
      </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.zip,.wav,.mp3,.flac,.als,.logicx,.ptx,.rpp,.flp,.mid,.midi"
        style={{ display: 'none' }}
        onChange={e => { if (e.target.files?.length) { enqueue(e.target.files); e.target.value = '' } }}
      />

      {/* Progress rows */}
      {queue.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
          {queue.map(item => (
            <div
              key={item.id}
              style={{
                padding: '7px 10px',
                borderRadius: 6,
                background: 'var(--bg-surface)',
                border: '0.5px solid var(--border)',
              }}
            >
              {/* Title + filename */}
              {item.status === 'uploading' && (
                <input
                  type="text"
                  value={item.title}
                  onChange={e => patch(item.id, { title: e.target.value })}
                  placeholder="Display name (optional)"
                  style={{
                    display: 'block',
                    width: '100%',
                    fontSize: 12,
                    color: 'var(--text)',
                    background: 'var(--bg-card)',
                    border: '0.5px solid var(--border)',
                    borderRadius: 5,
                    padding: '3px 7px',
                    outline: 'none',
                    marginBottom: 5,
                    boxSizing: 'border-box',
                  }}
                />
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <p style={{ flex: 1, fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.file.name}
                  <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>{fmtSize(item.file.size)}</span>
                </p>
                {item.status === 'error' && (
                  <button onClick={() => remove(item.id)} style={{ color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
                    <IconX size={12} />
                  </button>
                )}
              </div>

              {/* Progress bar */}
              {(item.status === 'uploading' || item.status === 'processing') && (
                <div style={{ marginTop: 5 }}>
                  <div style={{ height: 2, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${item.progress}%`, background: 'var(--accent)', borderRadius: 99, transition: 'width 0.2s' }} />
                  </div>
                  <p style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                    {item.status === 'processing' ? 'Saving…' : `${item.progress}%`}
                  </p>
                </div>
              )}

              {item.status === 'done' && <p style={{ fontSize: 11, color: 'var(--green)', marginTop: 3 }}>✓ Added</p>}
              {item.status === 'error' && <p style={{ fontSize: 11, color: 'var(--danger)', marginTop: 3 }}>{item.errorMessage}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
