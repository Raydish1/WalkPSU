import { useCallback, useEffect, useRef, useState } from 'react'

// A deliberate shake jolts well past normal handling (~2-5 m/s²). The debounce counts one shake per
// back-and-forth and keeps an honest player below the server's 8/s cap.
const THRESHOLD = 13
const DEBOUNCE_MS = 150
const GRAVITY = 9.81

export type MotionPermission = 'checking' | 'needs-tap' | 'granted' | 'denied' | 'unsupported'

type IOSMotionEvent = typeof DeviceMotionEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }

function initialPermission(): MotionPermission {
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return 'unsupported'
  return typeof (DeviceMotionEvent as IOSMotionEvent).requestPermission === 'function' ? 'needs-tap' : 'checking'
}

function jolt(e: DeviceMotionEvent) {
  const a = e.acceleration
  if (a && a.x !== null && a.y !== null && a.z !== null) return Math.hypot(a.x, a.y, a.z)
  const g = e.accelerationIncludingGravity
  if (g && g.x !== null && g.y !== null && g.z !== null) return Math.abs(Math.hypot(g.x, g.y, g.z) - GRAVITY)
  return null
}

/** Counts shakes from DeviceMotionEvent while `counting` is true. `tap()` is the fallback for devices with no sensor. */
export function useShakes(counting: boolean) {
  const [count, setCount] = useState(0)
  const [permission, setPermission] = useState<MotionPermission>(initialPermission)
  const lastShake = useRef(0)
  const countingRef = useRef(counting)

  useEffect(() => {
    countingRef.current = counting
  }, [counting])

  useEffect(() => {
    if (permission === 'needs-tap' || permission === 'denied' || permission === 'unsupported') return
    let sawSensor = false
    const onMotion = (e: DeviceMotionEvent) => {
      const magnitude = jolt(e)
      if (magnitude === null) return
      if (!sawSensor) {
        sawSensor = true
        setPermission('granted')
      }
      if (!countingRef.current || magnitude < THRESHOLD) return
      const now = performance.now()
      if (now - lastShake.current < DEBOUNCE_MS) return
      lastShake.current = now
      setCount((c) => c + 1)
    }
    window.addEventListener('devicemotion', onMotion)
    // Desktops expose DeviceMotionEvent but never fire it; after a moment, fall back to tapping.
    const probe = setTimeout(() => !sawSensor && setPermission('unsupported'), 1500)
    return () => {
      window.removeEventListener('devicemotion', onMotion)
      clearTimeout(probe)
    }
  }, [permission])

  /** iOS only shows its motion prompt from inside a user gesture. */
  const requestPermission = useCallback(async () => {
    try {
      const result = await (DeviceMotionEvent as IOSMotionEvent).requestPermission!()
      setPermission(result === 'granted' ? 'checking' : 'denied')
    } catch {
      setPermission('denied')
    }
  }, [])

  const tap = useCallback(() => {
    if (!countingRef.current) return
    const now = performance.now()
    if (now - lastShake.current < DEBOUNCE_MS) return
    lastShake.current = now
    setCount((c) => c + 1)
  }, [])

  /** False when shaking can't be counted (denied, no sensor, or never enabled): the screen offers tapping. */
  const motionReady = permission === 'granted' || permission === 'checking'

  return { count, permission, motionReady, requestPermission, tap }
}
