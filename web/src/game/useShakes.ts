import { useCallback, useEffect, useRef, useState } from 'react'
import { useDeviceMotion } from './motion'

export type { MotionPermission } from './motion'

// A deliberate shake jolts well past normal handling (~2-5 m/s²). The debounce counts one shake per
// back-and-forth and keeps an honest player below the server's 8/s cap.
const THRESHOLD = 13
const DEBOUNCE_MS = 150

/** Counts shakes from DeviceMotionEvent while `counting` is true. `tap()` is the fallback for devices with no sensor. */
export function useShakes(counting: boolean) {
  const [count, setCount] = useState(0)
  const lastShake = useRef(0)
  const countingRef = useRef(counting)

  useEffect(() => {
    countingRef.current = counting
  }, [counting])

  const tap = useCallback(() => {
    if (!countingRef.current) return
    const now = performance.now()
    if (now - lastShake.current < DEBOUNCE_MS) return
    lastShake.current = now
    setCount((c) => c + 1)
  }, [])

  const motion = useDeviceMotion((magnitude) => {
    if (magnitude >= THRESHOLD) tap()
  })

  return { count, ...motion, tap }
}
