import { useCallback, useEffect, useState } from 'react'
import { finishGame, getGameState, subscribeToTable } from '../lib/api'
import type { GameState } from '../lib/database.types'
import { phaseAt, type Phase } from './shakeoff'

const TICK_MS = 100
// Backup for a dropped Realtime socket (venue Wi-Fi): lobbies must still notice joins and starts.
const POLL_MS = 2000

/** Live Shake-Off state for one drop, with the phase recomputed every tick against server time. */
export function useGame(dropId: string) {
  // The device's clock can be seconds off, so phases are judged against server time: offset = server - device.
  const [snapshot, setSnapshot] = useState<{ state: GameState; offset: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const apply = useCallback((next: GameState) => {
    setSnapshot({ state: next, offset: Date.parse(next.server_now) - Date.now() })
    setError(null)
  }, [])
  const refresh = useCallback(
    () => getGameState(dropId).then(apply, (e: Error) => setError(e.message)),
    [dropId, apply],
  )

  useEffect(() => {
    refresh()
    const filter = `drop_id=eq.${dropId}`
    const offGames = subscribeToTable('games', refresh, filter)
    const offPlayers = subscribeToTable('game_players', refresh, filter)
    return () => {
      offGames()
      offPlayers()
    }
  }, [dropId, refresh])

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(tick)
  }, [])

  const state = snapshot?.state ?? null
  const phase: Phase = snapshot ? phaseAt(snapshot.state, now + snapshot.offset) : { kind: 'empty' }

  useEffect(() => {
    if (phase.kind === 'finished') return
    const poll = setInterval(refresh, POLL_MS)
    return () => clearInterval(poll)
  }, [phase.kind, refresh])

  // Every screen tries to finish once the grace period is over; the server keeps the first result. Retrying on
  // each new snapshot (the 2 s poll) covers a first attempt that a skewed clock sent a moment too early.
  const finishable = phase.kind === 'tallying' && phase.finishableInMs === 0
  useEffect(() => {
    if (!finishable) return
    finishGame(dropId).then(apply, () => {})
  }, [finishable, snapshot, dropId, apply])

  return { state, phase, error, refresh }
}
