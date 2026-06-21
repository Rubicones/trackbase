// Native status-bar + navigation-bar theming for the Capacitor Android/iOS shell.
//
// On the web this is a no-op. Inside the native app we sync both the top
// (status bar) and bottom (navigation bar) system bars to the app's current
// background color and switch the bar icons between light/dark to stay legible.
//
// Both bars are driven by a local plugin ("SystemBars", implemented in the
// android/ project). We don't use @capacitor/status-bar because on Android 15+
// edge-to-edge is enforced and setStatusBarColor / setBackgroundColor are
// ignored — the local plugin additionally paints the window background so the
// transparent bars reveal the app color.

import { Capacitor, registerPlugin } from '@capacitor/core'

interface SystemBarsPlugin {
  /**
   * Color both system bars to match the app background and set the bar icon
   * appearance. `darkIcons` = true renders dark icons (for light backgrounds).
   */
  apply(options: { color: string; darkIcons: boolean }): Promise<void>
}

const SystemBars = registerPlugin<SystemBarsPlugin>('SystemBars')

/**
 * Resolve the currently-applied `--background` design token to an opaque
 * `#rrggbb` hex string.
 *
 * The design tokens are authored in oklch, which the native bar APIs can't
 * consume directly. We let the browser resolve `var(--background)` on a probe
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
  // Dark background → light icons; light background → dark icons.
  void SystemBars.apply({ color, darkIcons: !isDark }).catch(() => {})
}
