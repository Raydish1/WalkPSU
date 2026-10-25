import { useCallback, useEffect, useRef, useState } from 'react'

const GRAVITY = 9.81

export type MotionPermission = 'checking' | 'needs-tap' | 'granted' | 'denied' | 'unsupported'

type IOSMotionEvent = typeof DeviceMotionEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }

function initialPermission(): MotionPermission {
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return 'unsupported'
  return typeof (DeviceMotionEvent as IOSMotionEvent).requestPermission === 'function' ? 'needs-tap' : 'checking'
}

/** How hard the phone is being moved, in m/s² with gravity removed; null when the event carries no readings. */
function jolt(e: DeviceMotionEvent) {
  const a = e.acceleration
  if (a && a.x !== null && a.y !== null && a.z !== null) return Math.hypot(a.x, a.y, a.z)
  const g = e.accelerationIncludingGravity
  if (g && g.x !== null && g.y !== null && g.z !== null) return Math.abs(Math.hypot(g.x, g.y, g.z) - GRAVITY)
  return null
}

/**
 * Calls `onJolt(magnitude)` for every motion reading, handling iOS's permission prompt and desktops that expose
 * DeviceMotionEvent but never fire it. Shared by the Shake-Off (counting) and Quick Draw (one flick).
 */
export function useDeviceMotion(onJolt: (magnitude: number) => void) {
  const [permission, setPermission] = useState<MotionPermission>(initialPermission)
  const onJoltRef = useRef(onJolt)

  useEffect(() => {
    onJoltRef.current = onJolt
  })

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
      onJoltRef.current(magnitude)
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

  /** False when motion can't be read (denied, no sensor, or never enabled): the screen offers tapping. */
  const motionReady = permission === 'granted' || permission === 'checking'

  return { permission, motionReady, requestPermission }
}
