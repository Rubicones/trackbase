/** Allow only same-origin relative paths for post-login redirects. */
export function sanitizeRedirectPath(
  next: string | null | undefined,
  fallback = '/dashboard',
): string {
  if (!next) return fallback

  const trimmed = next.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return fallback
  if (trimmed.includes('://') || trimmed.includes('\\')) return fallback

  return trimmed
}
