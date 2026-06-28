'use client'

import { useState } from 'react'
import { SectionLabel } from '@/components/design/AppShell'
import { TbMenuButton } from '@/components/design/TbButton'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
  assignee_id: string | null
  created_by: string
  created_at: string
  done_at: string | null
  position: number
}

export interface ChecklistMember {
  user_id: string
  username: string
  display_name: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRel(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const day = 86_400_000
  if (diff < day) {
    const h = Math.max(1, Math.round(diff / 3_600_000))
    return h <= 1 ? 'just now' : `${h}h ago`
  }
  const d = Math.round(diff / day)
  if (d < 14) return `${d}d ago`
  return `${Math.round(d / 7)}w ago`
}

function initials(username: string): string {
  return username.slice(0, 2).toUpperCase()
}

// ─── Inline SVG icons ─────────────────────────────────────────────────────────

function IconCheck({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M2 6l2.5 2.5L10 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function IconPencil({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M8 1.5l2.5 2.5L4 10.5H1.5V8L8 1.5z" stroke="currentColor" strokeWidth="0.9" strokeLinejoin="round" />
    </svg>
  )
}

function IconTrash({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M1.5 3h9M4.5 3V2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M10 3l-.75 7.5a.5.5 0 0 1-.5.5h-5.5a.5.5 0 0 1-.5-.5L2 3" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  )
}

function IconPlus({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function IconX({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" aria-hidden>
      <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function IconUser({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none" aria-hidden>
      <circle cx="5" cy="3.5" r="2" stroke="currentColor" strokeWidth="0.9" />
      <path d="M1 9c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  )
}

// ─── Checklist progress ───────────────────────────────────────────────────────

function progress(items: ChecklistItem[]) {
  const total = items.length
  const done = items.filter(i => i.done).length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  return { total, done, pct }
}

// ─── Assignee picker ──────────────────────────────────────────────────────────

function AssigneePicker({
  item,
  members,
  onAssign,
}: {
  item: ChecklistItem
  members: ChecklistMember[]
  onAssign: (assigneeId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const assignee = members.find(m => m.user_id === item.assignee_id) ?? null

  return (
    <span className="relative inline-flex">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 hover:text-lime transition"
        title="Assign band member"
      >
        <IconUser />
        <span className="normal-case tracking-normal">
          {assignee ? (assignee.display_name ?? `@${assignee.username}`) : 'Unassigned'}
        </span>
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 top-full left-0 mt-1 w-44 border border-border bg-popover shadow-2xl flex flex-col overflow-hidden">
            <TbMenuButton
              active={!item.assignee_id}
              className="justify-between"
              onClick={() => { onAssign(null); setOpen(false) }}
            >
              <span className="text-muted-foreground">Unassigned</span>
              {!item.assignee_id && <IconCheck size={11} />}
            </TbMenuButton>
            {members.map(m => (
              <TbMenuButton
                key={m.user_id}
                active={item.assignee_id === m.user_id}
                className="gap-2"
                onClick={() => { onAssign(m.user_id); setOpen(false) }}
              >
                <span className="size-5 bg-surface-2 border border-border grid place-items-center text-[9px] font-bold shrink-0">
                  {initials(m.username)}
                </span>
                <span className="flex-1 truncate text-left">{m.display_name ?? `@${m.username}`}</span>
                {item.assignee_id === m.user_id && <IconCheck size={11} />}
              </TbMenuButton>
            ))}
          </div>
        </>
      )}
    </span>
  )
}

// ─── Single row ───────────────────────────────────────────────────────────────

function ChecklistRow({
  item,
  members,
  onToggle,
  onUpdate,
  onDelete,
  onAssign,
  readOnly,
}: {
  item: ChecklistItem
  members: ChecklistMember[]
  onToggle: () => void
  onUpdate: (text: string) => void
  onDelete: () => void
  onAssign: (assigneeId: string | null) => void
  readOnly: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.text)

  function saveEdit() {
    const text = draft.trim()
    if (text && text !== item.text) onUpdate(text)
    setEditing(false)
  }

  const assignee = members.find(m => m.user_id === item.assignee_id) ?? null

  return (
    <li className={`group flex items-start gap-3 px-4 py-2.5 hover:bg-background/40 transition ${item.done ? 'opacity-60' : ''}`}>
      <button
        onClick={readOnly ? undefined : onToggle}
        disabled={readOnly}
        className={`shrink-0 mt-0.5 size-4 border grid place-items-center transition ${
          item.done
            ? 'bg-lime border-lime text-primary-foreground'
            : readOnly
            ? 'border-border cursor-default'
            : 'border-border hover:border-lime cursor-pointer'
        }`}
        aria-label={item.done ? 'Mark as not done' : 'Mark as done'}
      >
        {item.done && <IconCheck size={9} />}
      </button>

      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={e => {
              if (e.key === 'Enter') saveEdit()
              if (e.key === 'Escape') { setDraft(item.text); setEditing(false) }
            }}
            className="w-full bg-surface border border-lime px-2 py-1 text-xs focus:outline-none"
          />
        ) : (
          <div className={`text-xs leading-snug ${item.done ? 'line-through text-muted-foreground' : ''}`}>
            {item.text}
          </div>
        )}
        <div className="mt-1 flex items-center gap-2 text-[9px] uppercase tracking-widest text-muted-foreground font-mono">
          {!readOnly ? (
            <AssigneePicker item={item} members={members} onAssign={onAssign} />
          ) : assignee ? (
            <span className="inline-flex items-center gap-1">
              <IconUser />
              <span className="normal-case tracking-normal">{assignee.display_name ?? `@${assignee.username}`}</span>
            </span>
          ) : null}
          {!readOnly || assignee ? <span>·</span> : null}
          <span>
            {item.done && item.done_at
              ? `done ${formatRel(item.done_at)}`
              : `added ${formatRel(item.created_at)}`}
          </span>
        </div>
      </div>

      {!readOnly && (
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
          {!editing && (
            <button
              onClick={() => { setDraft(item.text); setEditing(true) }}
              className="size-6 border border-border grid place-items-center hover:border-lime hover:text-lime transition"
              aria-label="Edit task"
              title="Edit"
            >
              <IconPencil />
            </button>
          )}
          <button
            onClick={onDelete}
            className="size-6 border border-border grid place-items-center hover:border-destructive hover:text-destructive transition"
            aria-label="Delete task"
            title="Delete"
          >
            <IconTrash />
          </button>
        </div>
      )}

      {assignee && (
        <div
          className="shrink-0 size-6 bg-surface-2 border border-border grid place-items-center text-[9px] font-bold"
          title={`Assigned to ${assignee.display_name ?? assignee.username}`}
        >
          {initials(assignee.username)}
        </div>
      )}
    </li>
  )
}

// ─── Add-item row ─────────────────────────────────────────────────────────────

function AddRow({
  members,
  onAdd,
}: {
  members: ChecklistMember[]
  onAdd: (text: string, assigneeId: string | null) => void
}) {
  const [text, setText] = useState('')
  const [assigneeId, setAssigneeId] = useState<string | null>(null)

  function submit(e?: React.FormEvent) {
    e?.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    onAdd(trimmed, assigneeId)
    setText('')
    setAssigneeId(null)
  }

  return (
    <form
      onSubmit={submit}
      className="border-t border-border px-3 py-2 flex items-center gap-2 bg-background/40"
    >
      <span className="size-5 border border-dashed border-lime/60 text-lime grid place-items-center shrink-0">
        <IconPlus size={10} />
      </span>
      <input
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Add a task — e.g. redo bridge vocals"
        className="flex-1 min-w-0 bg-transparent text-xs focus:outline-none placeholder:text-muted-foreground/70"
      />
      {members.length > 0 && (
        <select
          value={assigneeId ?? ''}
          onChange={e => setAssigneeId(e.target.value || null)}
          className="bg-surface border border-border text-[10px] uppercase tracking-widest px-1.5 py-1 hidden sm:block"
          title="Assign"
        >
          <option value="">UNASSIGNED</option>
          {members.map(m => (
            <option key={m.user_id} value={m.user_id}>
              {m.display_name ?? m.username}
            </option>
          ))}
        </select>
      )}
      <button
        type="submit"
        disabled={!text.trim()}
        className="text-[10px] uppercase tracking-widest bg-lime text-primary-foreground px-2.5 py-1 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Add
      </button>
      {text && (
        <button
          type="button"
          onClick={() => { setText(''); setAssigneeId(null) }}
          className="size-6 grid place-items-center text-muted-foreground hover:text-foreground"
          aria-label="Clear"
        >
          <IconX />
        </button>
      )}
    </form>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SongChecklist({
  items,
  members,
  variant = 'full',
  readOnly = false,
  onToggle,
  onUpdate,
  onDelete,
  onAssign,
  onAdd,
}: {
  items: ChecklistItem[]
  members: ChecklistMember[]
  variant?: 'full' | 'compact'
  readOnly?: boolean
  onToggle?: (id: string) => void
  onUpdate?: (id: string, text: string) => void
  onDelete?: (id: string) => void
  onAssign?: (id: string, assigneeId: string | null) => void
  onAdd?: (text: string, assigneeId: string | null) => void
}) {
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('all')
  const { done, total } = progress(items)

  const visible = items.filter(i =>
    filter === 'all' ? true : filter === 'open' ? !i.done : i.done,
  )
  const sorted = [...visible].sort(
    (a, b) => Number(a.done) - Number(b.done) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  return (
    <section className="border border-border bg-surface/50">
      <header className="px-4 py-2.5 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <SectionLabel>CHECKLIST</SectionLabel>
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground tabular-nums">
              {done} / {total} DONE
            </span>
          </div>
          <div className="flex">
            {(['all', 'open', 'done'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[9px] uppercase tracking-widest px-2 py-1 border-b-2 transition ${
                  filter === f
                    ? 'border-lime text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </header>

      <ul className="divide-y divide-border">
        {sorted.length === 0 && (
          <li className="px-4 py-6 text-center text-[11px] text-muted-foreground">
            {filter === 'done'
              ? 'Nothing completed yet.'
              : filter === 'open'
              ? 'All clear — no open tasks.'
              : 'No tasks yet. Add the first one below.'}
          </li>
        )}
        {sorted.map(item => (
          <ChecklistRow
            key={item.id}
            item={item}
            members={members}
            readOnly={readOnly}
            onToggle={() => onToggle?.(item.id)}
            onUpdate={text => onUpdate?.(item.id, text)}
            onDelete={() => onDelete?.(item.id)}
            onAssign={assigneeId => onAssign?.(item.id, assigneeId)}
          />
        ))}
      </ul>

      {!readOnly && onAdd && (
        <AddRow members={members} onAdd={onAdd} />
      )}
    </section>
  )
}
