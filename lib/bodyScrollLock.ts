/**
 * Reference-counted body scroll lock for overlays/modals.
 * Safe when multiple modals/panels are open at once.
 */

let lockCount = 0
let savedOverflow = ''
let savedPaddingRight = ''
let savedHtmlOverflow = ''

export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {}

  if (lockCount === 0) {
    const scrollbarGap = window.innerWidth - document.documentElement.clientWidth
    savedOverflow = document.body.style.overflow
    savedPaddingRight = document.body.style.paddingRight
    savedHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    if (scrollbarGap > 0) {
      document.body.style.paddingRight = `${scrollbarGap}px`
    }
  }

  lockCount += 1

  let released = false
  return () => {
    if (released) return
    released = true
    lockCount = Math.max(0, lockCount - 1)
    if (lockCount === 0) {
      document.body.style.overflow = savedOverflow
      document.body.style.paddingRight = savedPaddingRight
      document.documentElement.style.overflow = savedHtmlOverflow
    }
  }
}
