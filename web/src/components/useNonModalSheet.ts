import { useEffect } from 'react'

/**
 * Vaul 1.1.2 doesn't pass `modal={false}` on to Radix, so Radix still blocks the page with `pointer-events: none` on
 * <body>. Vaul undoes that only when it opens the drawer itself; our non-modal sheets are opened from code (map taps,
 * search results), so undo it here.
 */
export function useNonModalSheet(open: boolean) {
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => (document.body.style.pointerEvents = 'auto'))
    return () => cancelAnimationFrame(frame)
  }, [open])
}
