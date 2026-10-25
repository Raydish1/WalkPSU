import { useEffect, useRef, useState, type RefObject } from 'react'
import { submitHeading } from '../lib/api'
import type { GameRound, LandmarkSettings } from '../lib/database.types'
import { angleDiff } from './compass'
import { circularMean } from './landmark'

const SAMPLE_MS = 100
// A player reading the landmark's name holds still too; only after turning this far does holding steady lock in.
const TURN_DEGREES = 10

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
 * Locks this phone's heading for each round: once it has turned at least TURN_DEGREES from where it faced as the
 * round began and then stayed within steady_degrees for steady_ms (and at least lock_after_ms in), or with the
 * latest reading when pointing time runs out.
 * Samples the compass on a fixed tick, so a phone held perfectly still (no new events) still counts as steady.
 */
export function useLandmarkAim({ dropId, round, settings, offset, headingRef, active }: Options) {
  const [aims, setAims] = useState<Record<number, Aim>>({})
  const [steady, setSteady] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const aimsRef = useRef(aims)
  // Per round, where the phone faced as the round began and whether it has turned since. Kept outside the effect,
  // which restarts whenever the clock offset improves, so a restart can't reset a turn the player already made.
  const turn = useRef<{ round: number; start: number; turned: boolean } | null>(null)
  // Read through a ref: a better clock offset must not restart the loop and drop the steadiness window.
  const offsetRef = useRef(offset)
  useEffect(() => {
    offsetRef.current = offset
  })
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
      const elapsed = Date.now() + offsetRef.current - roundStart
      const heading = headingRef.current
      if (elapsed < 0 || heading === null) return
      if (elapsed >= settings.point_seconds * 1000) {
        lock({ heading, how: 'timeout' })
        return
      }
      if (turn.current?.round !== roundNumber) turn.current = { round: roundNumber, start: heading, turned: false }
      turn.current.turned ||= angleDiff(heading, turn.current.start) >= TURN_DEGREES
      const turned = turn.current.turned
      samples.push({ at: elapsed, heading })
      while (samples.length && samples[0].at < elapsed - settings.steady_ms) samples.shift()
      const center = circularMean(samples.map((s) => s.heading))
      const spread = Math.max(...samples.map((s) => angleDiff(s.heading, center)))
      const held = spread <= settings.steady_degrees / 2 ? elapsed - samples[0].at : 0
      setSteady(turned ? Math.min(1, held / settings.steady_ms) : 0)
      if (turned && held >= settings.steady_ms - SAMPLE_MS && elapsed >= settings.lock_after_ms) lock({ heading: center, how: 'steady' })
      // Unsteady: start the window over from now.
      if (!held) samples.splice(0, samples.length - 1)
    }, SAMPLE_MS)
    return () => {
      clearInterval(tick)
      setSteady(0)
    }
  }, [active, roundNumber, roundStart, dropId, headingRef, settings.point_seconds, settings.steady_ms, settings.steady_degrees, settings.lock_after_ms])

  return { aims, steady, error }
}
