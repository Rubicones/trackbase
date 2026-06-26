/**
 * Security response headers (CSP, clickjacking, MIME sniffing, etc.).
 *
 * CSP is tuned for Trackbase: inline boot scripts in layout, Vercel Analytics,
 * direct R2 presigned uploads/downloads (preview mix MP3 + track blobs), the push SW, the
 * Essentia chord-detection web worker (requires unsafe-eval for Emscripten WASM),
 * soundfont-player MIDI samples (gleitz.github.io), and Google Analytics 4.
 */

function supabaseConnectOrigins(): string[] {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return []
  try {
    const { origin } = new URL(url)
    const wsOrigin = origin.replace(/^https:\/\//, 'wss://')
    return [origin, wsOrigin]
  } catch {
    return []
  }
}

export function buildContentSecurityPolicy(): string {
  const isDev = process.env.NODE_ENV === 'development'
  const supabase = supabaseConnectOrigins()

  const r2Origins = [
    'https://*.r2.cloudflarestorage.com',
    // Presigned URLs may be http:// in local dev (no upgrade-insecure-requests).
    ...(isDev ? ['http://*.r2.cloudflarestorage.com'] : []),
  ]

  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    // Essentia.js (chord detection worker) uses Emscripten's Function() at runtime.
    "'unsafe-eval'",
    "'wasm-unsafe-eval'",
    'https://va.vercel-scripts.com',
    'https://www.googletagmanager.com',
  ]

  const connectSrc = [
    "'self'",
    ...supabase,
    ...r2Origins,
    'https://vitals.vercel-insights.com',
    // Web Push (browser → push service)
    'https://fcm.googleapis.com',
    'https://updates.push.services.mozilla.com',
    // soundfont-player (MIDI preview + piano roll)
    'https://gleitz.github.io',
    // Google Analytics 4
    'https://www.google-analytics.com',
    'https://*.google-analytics.com',
    'https://www.googletagmanager.com',
    'https://analytics.google.com',
  ]

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    `media-src 'self' blob: ${r2Origins.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ')
}

export function securityHeaders(): { key: string; value: string }[] {
  return [
    { key: 'Content-Security-Policy', value: buildContentSecurityPolicy() },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
  ]
}
