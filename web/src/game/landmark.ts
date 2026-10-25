import type { GamePlayer, GameRound, GameState, RoundResult, Side } from '../lib/database.types'
import { normalizeDeg } from './compass'

/** Where we are in round `round`: pointing (for its first point_seconds), then the reveal. */
export function roundPhase(state: GameState, round: GameRound, serverNow: number) {
  const elapsed = serverNow - Date.parse(round.starts_at)
  const pointMs = (state.settings.point_seconds ?? 8) * 1000
  return elapsed < pointMs ? { kind: 'pointing' as const, elapsed, remainingMs: pointMs - elapsed } : { kind: 'reveal' as const, elapsed }
}

/** Mean direction of headings in degrees (a plain average breaks across north: 350° and 10° average to 0°). */
export function circularMean(headings: number[]) {
  const x = headings.reduce((sum, h) => sum + Math.cos((h * Math.PI) / 180), 0)
  const y = headings.reduce((sum, h) => sum + Math.sin((h * Math.PI) / 180), 0)
  return normalizeDeg((Math.atan2(y, x) * 180) / Math.PI)
}

/** A player's average error over every round so far; a round without a heading counts as miss_degrees. */
export function averageError(state: GameState, playerId: string, roundsSoFar: number) {
  const miss = state.settings.miss_degrees ?? 180
  if (roundsSoFar === 0) return null
  let sum = 0
  for (let round = 1; round <= roundsSoFar; round++) {
    sum += state.results.find((r) => r.player_id === playerId && r.round === round)?.value ?? miss
  }
  return sum / roundsSoFar
}

/** Each side's average error, as finish_game() scores it once `roundsSoFar` rounds are over. */
export function sideErrors(state: GameState, roundsSoFar: number): Record<Side, number | null> {
  const avg = (side: Side) => {
    const errors = state.players.filter((p) => p.side === side).map((p) => averageError(state, p.player_id, roundsSoFar))
    const known = errors.filter((e): e is number => e !== null)
    return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null
  }
  return { blue: avg('blue'), white: avg('white') }
}

/** The most accurate single point of the game. */
export function bestPoint(state: GameState) {
  const top = state.results.filter((r) => r.value !== null).sort((a, b) => a.value! - b.value!)[0]
  const player = top && state.players.find((p) => p.player_id === top.player_id)
  return top && player ? { player, degrees: top.value! } : null
}

export type PointedResult = { player: GamePlayer; result: RoundResult | null }

/** One round's headings, most accurate first, then players who didn't lock one. */
export function roundPoints(state: GameState, round: number): PointedResult[] {
  const rank = (x: PointedResult) => x.result?.value ?? Infinity
  return state.players
    .filter((p) => p.side)
    .map((player) => ({ player, result: state.results.find((r) => r.round === round && r.player_id === player.player_id) ?? null }))
    .sort((a, b) => rank(a) - rank(b))
}

/** Players on one side, lowest average error first. */
export function sideByAccuracy(state: GameState, side: Side, roundsSoFar: number) {
  const error = (p: GamePlayer) => averageError(state, p.player_id, roundsSoFar) ?? Infinity
  return state.players.filter((p) => p.side === side).sort((a, b) => error(a) - error(b) || a.joined_at.localeCompare(b.joined_at))
}

/** How many rounds have finished pointing at `serverNow` (all of them once the game is finished). */
export function roundsPointed(state: GameState, serverNow: number) {
  if (state.game?.finished_at) return state.rounds.length
  return state.rounds.filter((r) => roundPhase(state, r, serverNow).kind === 'reveal').length
}

export const formatDeg = (deg: number) => `${Math.round(deg)}°`
