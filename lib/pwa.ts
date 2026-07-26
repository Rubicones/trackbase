'use client'

/**
 * "Is this page running inside the installed app, rather than a browser tab?"
 *
 * Used to decide whether the landing page should forward to the app shell.
 * Getting it wrong is asymmetric: a false negative costs an installed user one
 * tap, while a false positive throws a prospective user off the marketing page
 * entirely. So this errs towards answering "no".
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 * Match only the display mode the manifest can actually produce, plus the iOS
 * legacy flag. `app/manifest.ts` declares `display: 'standalone'`, so an
 * install can only ever be launched as `standalone`. **If that manifest value
 * ever changes, change DISPLAY_MODES to match** — they are two halves of one
 * decision.
 *
 * ── What is deliberately NOT matched, and why ────────────────────────────────
 * `(display-mode: fullscreen)`: this is the bug that made ordinary visitors
 * bounce off the landing page. Per MDN, the fullscreen display mode is set by
 * *any* page calling the Fullscreen API, and Chrome also reports it for
 * browser-level fullscreen (F11) — it is not evidence of an install at all. It
 * was matched here even though the manifest never requests fullscreen, so
 * anything that put the tab into fullscreen redirected the visitor away.
 *
 * `(display-mode: minimal-ui)`: never requested by the manifest either. In
 * principle a browser with no standalone support could fall back to it, but no
 * major browser does, and the mode is defined as "a minimal set of UI elements"
 * — the same shape as the low-chrome in-app webviews that social links open in,
 * which is precisely the traffic a landing page must not redirect.
 *
 * Note that none of this is load-bearing for a normal launch: `start_url` is
 * `/dashboard`, so an installed app does not open `/` in the first place. This
 * check only covers an installed user navigating to `/` from inside the app.
 *
 * Auth state is intentionally absent. Whether someone is signed in has no
 * bearing on whether they are in a browser tab, and mixing the two is what
 * makes a landing page redirect "only some" of its visitors.
 */

/** Display modes an install of this app can actually launch in — mirrors `app/manifest.ts`. */
const DISPLAY_MODES = ['standalone'] as const

/** True only when the page is running as the installed app. */
export function isRunningAsInstalledPWA(): boolean {
  if (typeof window === 'undefined') return false

  const byDisplayMode = DISPLAY_MODES.some(mode => {
    try {
      return window.matchMedia(`(display-mode: ${mode})`).matches
    } catch {
      // matchMedia can throw on a malformed query in older engines; an
      // unanswerable question means "not installed".
      return false
    }
  })

  // iOS Safari home-screen apps predate display-mode support and set this
  // instead. Compared against `true` explicitly: on browsers where the property
  // is absent it is `undefined`, which must not read as installed.
  const iosHomeScreen =
    (navigator as Navigator & { standalone?: boolean }).standalone === true

  return byDisplayMode || iosHomeScreen
}
