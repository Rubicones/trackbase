// Native status-bar + navigation-bar theming for the Capacitor Android/iOS shell.
//
// On the web this is a no-op.  Inside the native app we sync both the top
// (status bar) and bottom (navigation bar) system bars to the app's current
// background color and switch the bar icons between light/dark to stay legible.
//
// The status bar is handled by the official @capacitor/status-bar plugin.
// The Android navigation bar has no official Capacitor plugin, so it is handled
// by a tiny local plugin ("SystemBars") implemented in the android/ project.

import { Capacitor, registerPlugin } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'

interface SystemBarsPlugin {
  /**
   * Set the Android navigation bar (bottom) background color and button
   * appearance.  `darkButtons` = true renders dark icons (for light
   * backgrounds).  No-op / safely ignored on platforms without a navigation
   * bar.
   */
  setNavigationBar(options: { color: string; darkButtons: boolean }): Promise<void>
}

const SystemBars = registerPlugin<SystemBarsPlugin>('SystemBars')

/**
 * Resolve the currently-applied `--background` design token to an opaque
 * `#rrggbb` hex string.
 *
 * The design tokens are authored in oklch, which the native bar APIs can't
 * consume directly.  We let the browser resolve `var(--background)` on a probe
 * element, then round-trip the computed color through a 1×1 canvas so we read
 * back the true rendered sRGB bytes regardless of how the engine serializes
 * the computed value (rgb(), oklch(), color(), …).
 */
function resolveBackgroundHex(): string {
  const fallback = '#000000'
  if (typeof document === 'undefined') return fallback

  let computed = ''
  try {
    const probe = document.createElement('span')
    probe.style.color = 'var(--background)'
    probe.style.display = 'none'
    document.documentElement.appendChild(probe)
    computed = getComputedStyle(probe).color
    document.documentElement.removeChild(probe)
  } catch {
    return fallback
  }
  if (!computed) return fallback

  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d')
    if (!ctx) return fallback
    ctx.fillStyle = '#000000'
    ctx.fillStyle = computed
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    const hex = (n: number) => n.toString(16).padStart(2, '0')
    return `#${hex(r)}${hex(g)}${hex(b)}`
  } catch {
    return fallback
  }
}

/**
 * Sync both system bars to the app background. Safe to call on every theme
 * change — it's a no-op outside the native shell.
 */
export function syncNativeSystemBars(isDark: boolean): void {
  if (!Capacitor.isNativePlatform()) return

  const color = resolveBackgroundHex()

  // Status bar (top) — official plugin.
  // Style.Dark = light icons (for a dark background); Style.Light = dark icons.
  void StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {})
  void StatusBar.setBackgroundColor({ color }).catch(() => {})
  void StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => {})

  // Navigation bar (bottom) — local plugin. Dark background → light buttons.
  void SystemBars.setNavigationBar({ color, darkButtons: !isDark }).catch(() => {})
}
