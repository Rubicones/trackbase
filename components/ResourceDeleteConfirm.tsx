'use client'

/** Inline delete confirmation — replaces native confirm(). */
export function ResourceDeleteConfirm({
  label,
  onCancel,
  onConfirm,
  deleting = false,
}: {
  label: string
  onCancel: () => void
  onConfirm: () => void
  deleting?: boolean
}) {
  return (
    <div className="flex flex-col gap-1 py-0.5">
      <p className="text-[10px] text-muted-foreground m-0 truncate">
        Remove &ldquo;{label}&rdquo;?
      </p>
      <div className="flex gap-3 justify-start">
        <button
          type="button"
          onClick={onCancel}
          className="text-[9px] uppercase tracking-widest text-muted-foreground hover:text-foreground bg-transparent border-0 cursor-pointer p-0"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={deleting}
          className="text-[9px] uppercase tracking-widest text-destructive hover:brightness-110 bg-transparent border-0 cursor-pointer p-0 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </div>
  )
}
