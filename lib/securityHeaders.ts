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

/**
 * Yandex Metrica hosts, per Yandex's own CSP guidance:
 * https://yandex.com/support/metrica/en/code/en/code/install-counter-csp
 *
 * The regional mirrors are NOT optional decoration. `mc.yandex.ru/watch/...`
 * — which is the actual hit/goal delivery endpoint, not a side channel —
 * redirects through these hosts for cross-service user sync, and CSP is
 * re-evaluated on **every redirect hop**. Allowing only the primary host means
 * the initial request passes and the redirect is blocked, which reads in the
 * console as "mc.yandex.ru blocked" even though mc.yandex.ru is allowlisted,
 * and drops the hit. Allow the whole documented set or expect missing data.
 *
 * `yastatic.net` serves tag sub-resources. `mc.webvisor.*` is omitted on
 * purpose: those are Session Replay only, which is deliberately off.
 */
const YANDEX_METRICA_HOSTS = [
  'mc.yandex.ru',
  'mc.yandex.az',
  'mc.yandex.by',
  'mc.yandex.co.il',
  'mc.yandex.com',
  'mc.yandex.com.am',
  'mc.yandex.com.ge',
  'mc.yandex.com.tr',
  'mc.yandex.ee',
  'mc.yandex.fr',
  'mc.yandex.kg',
  'mc.yandex.kz',
  'mc.yandex.lt',
  'mc.yandex.lv',
  'mc.yandex.md',
  'mc.yandex.tj',
  'mc.yandex.tm',
  'mc.yandex.uz',
]

const yandexHttps = YANDEX_METRICA_HOSTS.map(h => `https://${h}`)
const yandexWss = YANDEX_METRICA_HOSTS.map(h => `wss://${h}`)

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
    // Yandex Metrica: tag.js and the script-injected `watch` calls, plus
    // Yandex's static CDN which tag.js pulls sub-resources from.
    ...yandexHttps,
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
    // Yandex Metrica hit/goal delivery (see YANDEX_METRICA_HOSTS on why the
    // regional mirrors have to be here too).
    ...yandexHttps,
    ...yandexWss,
  ]

  const imgSrc = [
    "'self'",
    'data:',
    'blob:',
    // Meta Pixel
    'https://www.facebook.com',
    // GA4 delivers a share of its hits as *image* beacons, not just fetch:
    // googletagmanager.com/td and google-analytics.com/g/collect. Without
    // these, GA4 silently loses those hits — analytics endpoints belong in
    // img-src as well as connect-src, not one or the other.
    'https://www.googletagmanager.com',
    'https://www.google-analytics.com',
    'https://*.google-analytics.com',
    // Yandex Metrica: the <noscript> pixel plus GIF beacons (advert.gif,
    // sync pixels), which follow the same redirect chain as the hits.
    ...yandexHttps,
  ]

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src ${imgSrc.join(' ')}`,
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    `media-src 'self' blob: ${r2Origins.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    // Meta Pixel posts events via a hidden form and iframe to www.facebook.com/tr.
    "form-action 'self' https://www.facebook.com",
    // blob: + the Yandex hosts is what Metrica needs for the click map (and
    // would need for Session Replay, which is deliberately off).
    `frame-src 'self' https://www.facebook.com blob: ${yandexHttps.join(' ')}`,
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
