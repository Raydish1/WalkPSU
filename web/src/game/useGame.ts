import { useCallback, useEffect, useRef, useState } from 'react'
import { finishGame, getGameState, subscribeToTable } from '../lib/api'
import type { GameState } from '../lib/database.types'
import { phaseAt, type Phase } from './shakeoff'

const TICK_MS = 100
// Backup for a dropped Realtime socket (venue Wi-Fi): lobbies must still notice joins and starts.
const POLL_MS = 2000

/** Live mini-game state for one drop, with the phase recomputed every tick against server time. */
export function useGame(dropId: string) {
  const [state, setState] = useState<GameState | null>(null)
  // The device's clock can be seconds off, so phases are judged against server time: offset = server - device.
  // Each response gives a sample (server time vs. the midpoint of the request); the one with the shortest round
  // trip is the most accurate, and Quick Draw needs every phone to flash at the same moment.
  const [offset, setOffset] = useState(0)
  const bestRtt = useRef(Infinity)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const apply = useCallback((next: GameState, sentAt: number) => {
    const receivedAt = Date.now()
    const rtt = receivedAt - sentAt
    // Strictly better only: equal samples would nudge the offset every poll and restart everything timed by it.
    if (rtt < bestRtt.current) {
      bestRtt.current = rtt
      setOffset(Date.parse(next.server_now) - (sentAt + receivedAt) / 2)
    }
    setState(next)
    setError(null)
  }, [])
  const refresh = useCallback(() => {
    const sentAt = Date.now()
    return getGameState(dropId).then((next) => apply(next, sentAt), (e: Error) => setError(e.message))
  }, [dropId, apply])

  useEffect(() => {
    refresh()
    const filter = `drop_id=eq.${dropId}`
    const offGames = subscribeToTable('games', refresh, filter)
    const offPlayers = subscribeToTable('game_players', refresh, filter)
    const offResults = subscribeToTable('game_results', refresh, filter)
    return () => {
      offGames()
      offPlayers()
      offResults()
    }
  }, [dropId, refresh])

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(tick)
  }, [])

  const phase: Phase = state ? phaseAt(state, now + offset) : { kind: 'empty' }

  useEffect(() => {
    if (phase.kind === 'finished') return
    const poll = setInterval(refresh, POLL_MS)
    return () => clearInterval(poll)
  }, [phase.kind, refresh])

  // Every screen tries to finish once the grace period is over; the server keeps the first result. Retrying on
  // each new state (the 2 s poll) covers a first attempt that a skewed clock sent a moment too early.
  const finishable = phase.kind === 'tallying' && phase.finishableInMs === 0
  useEffect(() => {
    if (!finishable) return
    const sentAt = Date.now()
    finishGame(dropId).then((next) => apply(next, sentAt), () => {})
  }, [finishable, state, dropId, apply])

  /** Server time minus device time, in ms: add it to Date.now() to get server time. */
  return { state, phase, error, refresh, offset, serverNow: now + offset }
}
