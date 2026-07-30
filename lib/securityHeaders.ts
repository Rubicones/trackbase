/**
 * Security response headers (CSP, clickjacking, MIME sniffing, etc.).
 *
 * CSP is tuned for sonicdesk: inline boot scripts in layout, Vercel Analytics,
 * direct R2 presigned uploads/downloads (preview mix MP3 + track blobs), the push SW, the
 * Essentia chord-detection web worker (requires unsafe-eval for Emscripten WASM),
 * soundfont-player MIDI samples (gleitz.github.io), Google Analytics 4, the
 * Meta Pixel, and Yandex Metrica.
 *
 * ANY new third-party script must be added here in the same change, or it is
 * silently blocked in production only (dev is same-origin, so this file is easy
 * to forget until the console shows "Refused to load ... violates directive").
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
    // Meta Pixel base script
    'https://connect.facebook.net',
    // Yandex Metrica: tag.js, plus Yandex's static CDN which tag.js pulls
    // sub-resources from.
    'https://mc.yandex.ru',
    'https://yastatic.net',
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
    // Meta Pixel (fbevents.js sends events to www.facebook.com/tr)
    'https://www.facebook.com',
    'https://connect.facebook.net',
    // Yandex Metrica hit/goal delivery. Only the primary host is allowed —
    // Yandex also lists ~17 regional mirrors (mc.yandex.by/.kz/.com.tr/...)
    // used for cross-service user sync, but blocking those costs nothing:
    // hits, goals and reports all go to mc.yandex.ru.
    'https://mc.yandex.ru',
    'wss://mc.yandex.ru',
  ]

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // mc.yandex.ru: the <noscript> tracking pixel and Metrica's GIF beacons.
    "img-src 'self' data: blob: https://www.facebook.com https://mc.yandex.ru",
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    `media-src 'self' blob: ${r2Origins.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    // Meta Pixel posts events via a hidden form and iframe to www.facebook.com/tr.
    "form-action 'self' https://www.facebook.com",
    // blob: + mc.yandex.ru is what Metrica needs for the click map (and would
    // need for Session Replay, which is deliberately off).
    "frame-src 'self' https://www.facebook.com blob: https://mc.yandex.ru",
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
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), notifications=(self)' },
  ]
}
