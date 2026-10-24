import type { GamePlayer, GameState, Side } from '../lib/database.types'

export type Phase =
  | { kind: 'empty' }
  | { kind: 'lobby'; startsInMs: number | null }
  | { kind: 'playing'; remainingMs: number }
  | { kind: 'tallying'; finishableInMs: number }
  | { kind: 'finished'; winner: Side }

/** Derives the phase from server timestamps; `serverNow` is the device clock corrected by the server offset. */
export function phaseAt(state: GameState, serverNow: number): Phase {
  const { game, settings } = state
  if (!game) return { kind: 'empty' }
  if (game.finished_at && game.winner_side) return { kind: 'finished', winner: game.winner_side }
  if (!game.started_at) return { kind: 'lobby', startsInMs: null }
  const start = Date.parse(game.started_at)
  const end = start + settings.game_seconds * 1000
  if (serverNow < start) return { kind: 'lobby', startsInMs: start - serverNow }
  if (serverNow < end) return { kind: 'playing', remainingMs: end - serverNow }
  return { kind: 'tallying', finishableInMs: Math.max(0, end + settings.submit_grace_seconds * 1000 - serverNow) }
}

export const SIDES: Record<Side, { label: string; color: string; ink: string }> = {
  blue: { label: 'Blue', color: '#1e40af', ink: '#ffffff' },
  white: { label: 'White', color: '#f8fafc', ink: '#0f172a' },
}

export type SideTotals = Record<Side, { players: number; shakes: number; perPlayer: number }>

/** Shakes per player on each side, the same normalization finish_game() uses. `live` overrides stored counts. */
export function sideTotals(players: GamePlayer[], live: ReadonlyMap<string, number>): SideTotals {
  const totals: SideTotals = { blue: { players: 0, shakes: 0, perPlayer: 0 }, white: { players: 0, shakes: 0, perPlayer: 0 } }
  for (const p of players) {
    if (!p.side) continue
    totals[p.side].players += 1
    totals[p.side].shakes += Math.max(p.shakes, live.get(p.player_id) ?? 0)
  }
  for (const side of ['blue', 'white'] as const) {
    totals[side].perPlayer = totals[side].players ? totals[side].shakes / totals[side].players : 0
  }
  return totals
}

/** 0..1 share of the rope Blue holds; 0.5 when nobody has shaken yet. */
export function blueShare(totals: SideTotals) {
  const sum = totals.blue.perPlayer + totals.white.perPlayer
  return sum === 0 ? 0.5 : totals.blue.perPlayer / sum
}
