/** Branch / track icons shared by chat and resource context chips. */

export function IconBranch({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="4" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="12" r="1.8" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="4" r="1.8" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 5.8v4.4M5.8 4H8a2 2 0 0 1 2 2v3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export function IconNote({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6 12V4l7-1.5v8" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <ellipse cx="4.3" cy="12" rx="1.7" ry="1.4" stroke="currentColor" strokeWidth="1.2" />
      <ellipse cx="11.3" cy="10.5" rx="1.7" ry="1.4" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}
