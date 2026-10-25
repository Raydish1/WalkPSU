import { useCallback, useEffect, useRef, useState } from 'react'
import type { MotionPermission } from './motion'

type PermissionEvent = { requestPermission?: () => Promise<'granted' | 'denied'> }

function initialPermission(): MotionPermission {
  if (typeof window === 'undefined') return 'unsupported'
  const motion = typeof DeviceMotionEvent === 'undefined' ? null : (DeviceMotionEvent as unknown as PermissionEvent)
  const orientation = typeof DeviceOrientationEvent === 'undefined' ? null : (DeviceOrientationEvent as unknown as PermissionEvent)
  if (!motion && !orientation) return 'unsupported'
  if (typeof motion?.requestPermission === 'function' || typeof orientation?.requestPermission === 'function') return 'needs-tap'
  return 'checking'
}

/**
 * Tilt (deviceorientation gamma) is the primary Needle Rain control. Arrow keys, A/D, and the on-screen
 * stick are the fallback when motion is denied, missing, or the player is on a laptop. Same permission
 * shape as the Shake-Off: iOS only prompts from a tap, and a desktop that never fires a reading falls through.
 */
export function useSteer() {
  const [permission, setPermission] = useState<MotionPermission>(initialPermission)
  const gammaRef = useRef<number | null>(null)
  const keysRef = useRef({ left: false, right: false })
  const stickRef = useRef(0)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        keysRef.current.left = true
        e.preventDefault()
      }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        keysRef.current.right = true
        e.preventDefault()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keysRef.current.left = false
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keysRef.current.right = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useEffect(() => {
    if (permission === 'needs-tap' || permission === 'denied' || permission === 'unsupported') return
    let sawSensor = false
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.gamma === null) return
      if (!sawSensor) {
        sawSensor = true
        setPermission('granted')
      }
      gammaRef.current = e.gamma
    }
    window.addEventListener('deviceorientation', onOrientation)
    const probe = setTimeout(() => {
      if (!sawSensor) {
        gammaRef.current = null
        setPermission('unsupported')
      }
    }, 1500)
    return () => {
      window.removeEventListener('deviceorientation', onOrientation)
      clearTimeout(probe)
    }
  }, [permission])

  const requestPermission = useCallback(async () => {
    try {
      const ask = async (ctor: PermissionEvent | null) => (typeof ctor?.requestPermission === 'function' ? ctor.requestPermission() : 'granted')
      const motion = await ask(typeof DeviceMotionEvent === 'undefined' ? null : (DeviceMotionEvent as unknown as PermissionEvent))
      const orientation = await ask(typeof DeviceOrientationEvent === 'undefined' ? null : (DeviceOrientationEvent as unknown as PermissionEvent))
      setPermission(motion === 'granted' && orientation === 'granted' ? 'checking' : 'denied')
    } catch {
      setPermission('denied')
    }
  }, [])

  return { permission, motionReady: permission === 'granted', requestPermission, gammaRef, keysRef, stickRef }
}
