import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { submitReaction } from '../lib/api'
import type { GameRound, TimedSettings } from '../lib/database.types'
import { useDeviceMotion } from './motion'

// Very sensitive on purpose: any deliberate flick counts. A phone held still reads ~0.1-0.5 m/s² and under ~15°/s;
// a quick wrist flick passes 3 m/s² or 100°/s. Rotation matters most: a flick is mostly a twist, which linear
// acceleration barely sees (especially on phones that only report acceleration including gravity).
const FLICK_ACCELERATION = 3
const FLICK_ROTATION = 100

/** Fastest rotation in this reading, in degrees per second (0 without a gyroscope). */
function spin(e: DeviceMotionEvent) {
  const r = e.rotationRate
  return r ? Math.max(Math.abs(r.alpha ?? 0), Math.abs(r.beta ?? 0), Math.abs(r.gamma ?? 0)) : 0
}
// Movement right after a round begins is still the last round's flick, so early flicks count from here.
const ARM_MS = 1000

/** What this phone saw in one round: a time in ms, a false start, or no flick before the window closed. */
export type DrawResult = { kind: 'time'; ms: number } | { kind: 'false-start' } | { kind: 'too-slow' }

export type DrawStage =
  | { kind: 'waiting' }
  | { kind: 'hold'; round: number }
  | { kind: 'draw'; round: number }
  | { kind: 'done'; round: number; result: DrawResult }

type Options = { dropId: string; rounds: GameRound[]; settings: Pick<TimedSettings, 'min_reaction_ms' | 'max_reaction_ms'>; offset: number; serverNow: number; active: boolean }

/**
 * Quick Draw on the phone. Each round's "DRAW!" is scheduled for the server's signal moment converted to this
 * device's clock, so every phone flashes together. Reaction time runs on performance.now(), from the frame the flash
 * was committed to the flick, so network lag never counts. A flick before the signal is a false start.
 */
export function useQuickDraw({ dropId, rounds, settings, offset, serverNow, active }: Options) {
  const [results, setResults] = useState<Record<number, DrawResult>>({})
  /** The round whose "DRAW!" is on screen, and the performance.now() of the commit that put it there. */
  const [shownRound, setShownRound] = useState<number | null>(null)
  const shownAt = useRef<{ round: number; at: number } | null>(null)
  const resultsRef = useRef(results)
  const [error, setError] = useState<string | null>(null)

  const record = useCallback(
    (round: number, result: DrawResult) => {
      if (resultsRef.current[round]) return
      resultsRef.current = { ...resultsRef.current, [round]: result }
      setResults(resultsRef.current)
      if (result.kind === 'too-slow') return
      submitReaction(dropId, round, result.kind === 'time' ? result.ms : null).then(
        () => setError(null),
        (e: Error) => setError(e.message),
      )
    },
    [dropId],
  )

  // Schedule every upcoming flash. Re-running when a better clock offset arrives only moves timers not yet fired.
  const schedule = JSON.stringify(rounds.map((r) => r.signal_at))
  useEffect(() => {
    if (!active) return
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const r of rounds) {
      const delay = Date.parse(r.signal_at!) - offset - Date.now()
      if (delay < -settings.max_reaction_ms || resultsRef.current[r.round]) continue
      timers.push(
        setTimeout(() => {
          if (resultsRef.current[r.round]) return
          // Commit the flash now so the clock starts with the frame that shows it, not after React gets around to it.
          flushSync(() => setShownRound(r.round))
          shownAt.current = { round: r.round, at: performance.now() }
          navigator.vibrate?.(200)
          timers.push(setTimeout(() => record(r.round, { kind: 'too-slow' }), settings.max_reaction_ms))
        }, Math.max(0, delay)),
      )
    }
    return () => timers.forEach(clearTimeout)
    // `rounds` is compared by its signal times (`schedule`); a new array with the same schedule changes nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, offset, active, settings.max_reaction_ms, record])

  const round = rounds.filter((r) => Date.parse(r.starts_at) <= serverNow).at(-1) ?? null
  const roundRef = useRef(round)
  useEffect(() => {
    roundRef.current = round
  })

  const flick = useCallback(() => {
    const now = performance.now()
    const r = roundRef.current
    if (!active || !r || resultsRef.current[r.round]) return
    if (shownAt.current?.round === r.round) {
      const ms = Math.round(now - shownAt.current.at)
      record(r.round, ms < settings.min_reaction_ms ? { kind: 'false-start' } : { kind: 'time', ms })
    } else if (Date.now() + offset >= Date.parse(r.starts_at) + ARM_MS) {
      record(r.round, { kind: 'false-start' })
    }
  }, [active, offset, record, settings.min_reaction_ms])

  const motion = useDeviceMotion((magnitude, e) => {
    if (magnitude >= FLICK_ACCELERATION || spin(e) >= FLICK_ROTATION) flick()
  })

  let stage: DrawStage = { kind: 'waiting' }
  if (round) {
    const result = results[round.round]
    if (result) stage = { kind: 'done', round: round.round, result }
    else if (shownRound === round.round) stage = { kind: 'draw', round: round.round }
    else if (serverNow >= Date.parse(round.starts_at) + ARM_MS) stage = { kind: 'hold', round: round.round }
  }

  return { stage, results, error, flick, ...motion }
}
