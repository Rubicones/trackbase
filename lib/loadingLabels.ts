/** Studio-voice loading copy keyed by route or context. */
export function getLoadingLabel(pathname: string): string {
  const path = pathname.split('?')[0]

  if (path === '/dashboard') return 'Syncing bands'
  if (/^\/band\/[^/]+\/project\/[^/]+$/.test(path)) return 'Loading mixer'
  if (/^\/band\/[^/]+$/.test(path)) return 'Opening studio'
  if (/^\/projects\/[^/]+$/.test(path)) return 'Loading session'
  if (path === '/onboarding') return 'Setting up studio'
  if (path === '/auth/callback') return 'Completing sign-in'
  if (path.startsWith('/auth')) return 'Signing in'
  if (path === '/uikit') return 'Loading design system'
  if (path.startsWith('/invite/')) return 'Processing invite'
  if (path === '/') return 'Initializing'

  return 'Loading'
}

/** Inline / panel loaders where route alone isn't specific enough. */
export const LOADING_LABELS = {
  bands: 'Fetching bands',
  tracks: 'Loading tracks',
  structure: 'Reading structure',
  mix: 'Rendering mix',
  upload: 'Uploading stems',
} as const
