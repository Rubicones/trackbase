'use client'

import { useCallback, useRef, useState, type MouseEvent, type TouchEvent } from 'react'

function isInteractiveTarget(target: EventTarget | null) {
  return Boolean(
    (target as HTMLElement | null)?.closest(
      'button, a, input, textarea, select, [data-stop-row-expand], [data-resource-context-popover]',
    ),
  )
}

/** Collapsed resource row — tap/click toggles; ignores action buttons/links. */
export function useResourceRowExpand(initial = false) {
  const [expanded, setExpanded] = useState(initial)
  const touchHandledRef = useRef(false)

  const toggle = useCallback(() => {
    setExpanded(v => !v)
  }, [])

  const onTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (isInteractiveTarget(e.target)) return
      e.preventDefault()
      touchHandledRef.current = true
      toggle()
    },
    [toggle],
  )

  const onClick = useCallback(
    (e: MouseEvent) => {
      if (isInteractiveTarget(e.target)) return
      if (touchHandledRef.current) {
        touchHandledRef.current = false
        return
      }
      toggle()
    },
    [toggle],
  )

  return {
    expanded,
    setExpanded,
    rowHandlers: { onClick, onTouchEnd },
  }
}
