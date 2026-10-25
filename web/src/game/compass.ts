import { useCallback, useEffect, useRef, useState } from 'react'

// Phone compasses report magnetic north. At State College it lies ~10.5° west of true north (NOAA WMM, 2026), and
// bearings to landmarks are true, so true heading = magnetic heading + this (negative = west).
const MAGNETIC_DECLINATION_DEG = -10.5

export type CompassStatus = 'checking' | 'needs-tap' | 'ready' | 'denied' | 'unsupported'

type IOSOrientationEvent = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> }
type CompassEvent = DeviceOrientationEvent & { webkitCompassHeading?: number }

export const normalizeDeg = (deg: number) => ((deg % 360) + 360) % 360

/** Smallest angle between two headings, 0..180 (SQL angle_diff). */
export const angleDiff = (a: number, b: number) => 180 - Math.abs(180 - normalizeDeg(a - b))

function initialStatus(): CompassStatus {
  if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return 'unsupported'
  return typeof (DeviceOrientationEvent as IOSOrientationEvent).requestPermission === 'function' ? 'needs-tap' : 'checking'
}

/**
 * Magnetic heading of the phone's top edge from one orientation event, or null if it carries none.
 * iOS: webkitCompassHeading (clockwise from north). Android: an absolute alpha (counterclockwise), corrected for a
 * rotated screen.
 */
function magneticHeading(e: CompassEvent) {
  if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) return e.webkitCompassHeading
  if (e.absolute && e.alpha !== null) return normalizeDeg(360 - e.alpha + (screen.orientation?.angle ?? 0))
  return null
}

/**
 * The phone's true heading, live. `heading` is null until the first reading; `headingRef` always holds the latest
 * one for code that samples on its own clock. Devices without a compass (and desktops) end up 'unsupported' after a
 * short probe, and those players can watch instead of play.
 */
export function useCompass() {
  const [status, setStatus] = useState<CompassStatus>(initialStatus)
  const [heading, setHeading] = useState<number | null>(null)
  const headingRef = useRef<number | null>(null)

  useEffect(() => {
    if (status === 'needs-tap' || status === 'denied' || status === 'unsupported') return
    let seen = false
    const onOrientation = (e: Event) => {
      const magnetic = magneticHeading(e as CompassEvent)
      if (magnetic === null) return
      if (!seen) {
        seen = true
        setStatus('ready')
      }
      const trueHeading = normalizeDeg(magnetic + MAGNETIC_DECLINATION_DEG)
      headingRef.current = trueHeading
      setHeading(trueHeading)
    }
    // Android fires absolute readings on their own event; iOS adds webkitCompassHeading to the plain one.
    window.addEventListener('deviceorientationabsolute', onOrientation)
    window.addEventListener('deviceorientation', onOrientation)
    const probe = setTimeout(() => !seen && setStatus('unsupported'), 2000)
    return () => {
      window.removeEventListener('deviceorientationabsolute', onOrientation)
      window.removeEventListener('deviceorientation', onOrientation)
      clearTimeout(probe)
    }
  }, [status])

  /** iOS only shows its motion & orientation prompt from inside a user gesture. */
  const requestPermission = useCallback(async () => {
    try {
      const result = await (DeviceOrientationEvent as IOSOrientationEvent).requestPermission!()
      setStatus(result === 'granted' ? 'checking' : 'denied')
    } catch {
      setStatus('denied')
    }
  }, [])

  return { status, heading, headingRef, requestPermission }
}
