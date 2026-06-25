/**
 * Security response headers (CSP, clickjacking, MIME sniffing, etc.).
 *
 * CSP is tuned for Trackbase: inline boot scripts in layout, Vercel Analytics,
 * Supabase Auth/Realtime, direct R2 presigned uploads, the push SW, the
 * Essentia chord-detection web worker (requires unsafe-eval for Emscripten WASM),
 * and soundfont-player MIDI samples (gleitz.github.io).
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

  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    // Essentia.js (chord detection worker) uses Emscripten's Function() at runtime.
    "'unsafe-eval'",
    "'wasm-unsafe-eval'",
    'https://va.vercel-scripts.com',
  ]

  const connectSrc = [
    "'self'",
    ...supabase,
    'https://*.r2.cloudflarestorage.com',
    'https://vitals.vercel-insights.com',
    // Web Push (browser → push service)
    'https://fcm.googleapis.com',
    'https://updates.push.services.mozilla.com',
    // soundfont-player (MIDI preview + piano roll)
    'https://gleitz.github.io',
  ]

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'self' blob:",
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
