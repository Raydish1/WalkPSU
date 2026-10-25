import type { GamePlayer, GameRound, GameState, RoundResult, Side } from '../lib/database.types'

/** The round in progress at `serverNow` (the last one that has begun), or null before the first. */
export function currentRound(rounds: GameRound[], serverNow: number) {
  return rounds.filter((r) => Date.parse(r.starts_at) <= serverNow).at(-1) ?? null
}

/** Each player's best valid time, or null if every round was a false start or a miss. */
export function bestTimes(results: RoundResult[]) {
  const best = new Map<string, number | null>()
  for (const r of results) {
    const prev = best.get(r.player_id) ?? null
    if (r.value !== null && (prev === null || r.value < prev)) best.set(r.player_id, r.value)
    else if (!best.has(r.player_id)) best.set(r.player_id, null)
  }
  return best
}

/**
 * Average of each player's best time per side. `final` scores it as finish_game() does: a player with no valid time
 * counts as max_reaction_ms. Mid-game, only players with a time count. Null when nobody on the side counts yet.
 */
export function sideAverages(state: GameState, final: boolean): Record<Side, number | null> {
  const worst = state.settings.max_reaction_ms ?? 1500
  const best = bestTimes(state.results)
  const avg = (side: Side) => {
    const times = state.players
      .filter((p) => p.side === side)
      .flatMap((p) => {
        const time = best.get(p.player_id) ?? null
        return time !== null ? [time] : final ? [worst] : []
      })
    return times.length ? times.reduce((a, b) => a + b, 0) / times.length : null
  }
  return { blue: avg('blue'), white: avg('white') }
}

/** The fastest single valid reaction of the game. */
export function fastestDraw(state: GameState) {
  const top = state.results.filter((r) => r.value !== null).sort((a, b) => a.value! - b.value!)[0]
  const player = top && state.players.find((p) => p.player_id === top.player_id)
  return top && player ? { player, ms: top.value! } : null
}

export type RankedResult = { player: GamePlayer; result: RoundResult | null }

/** One round's results, fastest first, then false starts, then players who haven't reported (yet). */
export function roundRanking(state: GameState, round: number): RankedResult[] {
  const rank = (x: RankedResult) => (x.result?.value ?? (x.result?.false_start ? 1e9 : 2e9))
  return state.players
    .filter((p) => p.side)
    .map((player) => ({ player, result: state.results.find((r) => r.round === round && r.player_id === player.player_id) ?? null }))
    .sort((a, b) => rank(a) - rank(b))
}

/** Players on one side, fastest best time first. */
export function sideByBestTime(state: GameState, side: Side) {
  const best = bestTimes(state.results)
  const time = (p: GamePlayer) => best.get(p.player_id) ?? Infinity
  return state.players.filter((p) => p.side === side).sort((a, b) => time(a) - time(b) || a.joined_at.localeCompare(b.joined_at))
}

export const formatMs = (ms: number) => `${Math.round(ms)} ms`
