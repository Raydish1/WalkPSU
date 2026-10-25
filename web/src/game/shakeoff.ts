import type { GamePlayer, GameState, Side } from '../lib/database.types'

export type Phase =
  | { kind: 'empty' }
  | { kind: 'lobby'; startsInMs: number | null }
  | { kind: 'playing'; remainingMs: number }
  | { kind: 'tallying'; finishableInMs: number }
  | { kind: 'finished'; winner: Side | null }

/** Derives the phase from server timestamps; `serverNow` is the device clock corrected by the server offset. */
export function phaseAt(state: GameState, serverNow: number): Phase {
  const { game, settings } = state
  if (!game) return { kind: 'empty' }
  if (game.finished_at) return { kind: 'finished', winner: game.winner_side }
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

export const shakesOf = (p: GamePlayer, live: ReadonlyMap<string, number>) => Math.max(p.shakes, live.get(p.player_id) ?? 0)

/** One side's players, top shaker first. */
export function sidePlayers(players: GamePlayer[], side: Side, live: ReadonlyMap<string, number>) {
  return players
    .filter((p) => p.side === side)
    .sort((a, b) => shakesOf(b, live) - shakesOf(a, live) || a.joined_at.localeCompare(b.joined_at))
}

/** Top shaker across both sides. */
export function mvp(players: GamePlayer[]) {
  return [...players].filter((p) => p.side).sort((a, b) => b.shakes - a.shakes || a.joined_at.localeCompare(b.joined_at))[0] ?? null
}

/** "Rayhan", "Rayhan & Alex", "Rayhan, Alex & Sam", then "Rayhan, Alex & 3 others" past three names. */
export function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
  return `${names.slice(0, 2).join(', ')} & ${names.length - 2} others`
}
