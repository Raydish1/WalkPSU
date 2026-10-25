import { useEffect, useRef, useState, type RefObject } from 'react'
import { submitHeading } from '../lib/api'
import type { GameRound, LandmarkSettings } from '../lib/database.types'
import { angleDiff } from './compass'
import { circularMean } from './landmark'

const SAMPLE_MS = 100

/** A round's locked heading (true degrees), and whether it locked by holding steady or when time ran out. */
export type Aim = { heading: number; how: 'steady' | 'timeout' }

type Options = {
  dropId: string
  round: GameRound | null
  settings: Pick<LandmarkSettings, 'point_seconds' | 'steady_ms' | 'steady_degrees' | 'lock_after_ms'>
  offset: number
  headingRef: RefObject<number | null>
  active: boolean
}

/**
 * Locks this phone's heading for each round: once it has stayed within steady_degrees for steady_ms (and at least
 * lock_after_ms in, so nobody locks before turning), or with the latest reading when pointing time runs out.
 * Samples the compass on a fixed tick, so a phone held perfectly still (no new events) still counts as steady.
 */
export function useLandmarkAim({ dropId, round, settings, offset, headingRef, active }: Options) {
  const [aims, setAims] = useState<Record<number, Aim>>({})
  const [steady, setSteady] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const aimsRef = useRef(aims)
  const roundNumber = round?.round ?? null
  const roundStart = round ? Date.parse(round.starts_at) : null

  useEffect(() => {
    if (!active || roundNumber === null || roundStart === null) return
    const samples: { at: number; heading: number }[] = []
    const lock = (aim: Aim) => {
      if (aimsRef.current[roundNumber]) return
      aimsRef.current = { ...aimsRef.current, [roundNumber]: aim }
      setAims(aimsRef.current)
      navigator.vibrate?.(60)
      submitHeading(dropId, roundNumber, Math.min(aim.heading, 359.999)).then(
        () => setError(null),
        (e: Error) => setError(e.message),
      )
    }
    const tick = setInterval(() => {
      if (aimsRef.current[roundNumber]) return
      const elapsed = Date.now() + offset - roundStart
      const heading = headingRef.current
      if (elapsed < 0 || heading === null) return
      if (elapsed >= settings.point_seconds * 1000) {
        lock({ heading, how: 'timeout' })
        return
      }
      samples.push({ at: elapsed, heading })
      while (samples.length && samples[0].at < elapsed - settings.steady_ms) samples.shift()
      const center = circularMean(samples.map((s) => s.heading))
      const spread = Math.max(...samples.map((s) => angleDiff(s.heading, center)))
      const held = spread <= settings.steady_degrees / 2 ? elapsed - samples[0].at : 0
      setSteady(Math.min(1, held / settings.steady_ms))
      if (held >= settings.steady_ms - SAMPLE_MS && elapsed >= settings.lock_after_ms) lock({ heading: center, how: 'steady' })
      // Unsteady: start the window over from now.
      if (!held) samples.splice(0, samples.length - 1)
    }, SAMPLE_MS)
    return () => {
      clearInterval(tick)
      setSteady(0)
    }
  }, [active, roundNumber, roundStart, offset, dropId, headingRef, settings.point_seconds, settings.steady_ms, settings.steady_degrees, settings.lock_after_ms])

  return { aims, steady, error }
}
