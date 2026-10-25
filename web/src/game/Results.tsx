import type { GamePlayer, GameState, Side } from '../lib/database.types'
import { bestPoint, formatDeg, sideByAccuracy } from './landmark'
import { fastestDraw, formatMs, sideByBestTime } from './quickdraw'
import { joinNames, mvp, sidePlayers } from './shakeoff'

const NO_LIVE: ReadonlyMap<string, number> = new Map()

/** The winning side, best player first: top shaker, fastest best time, or lowest average error. */
function winnersOf(state: GameState, winner: Side) {
  if (state.kind === 'quick_draw') return sideByBestTime(state, winner)
  if (state.kind === 'landmark') return sideByAccuracy(state, winner, state.rounds.length)
  return sidePlayers(state.players, winner, NO_LIVE)
}

/** "Rayhan, Alex & Sam win! +30 points each", best player first. */
export function WinnerHeadline({ state, winner, points, className }: { state: GameState; winner: Side; points?: number; className: string }) {
  const winners = winnersOf(state, winner)
  return (
    <div className={className}>
      <h1>
        {joinNames(winners.map((p) => p.display_name))} {winners.length === 1 ? 'wins' : 'win'}!
      </h1>
      {points !== undefined && (
        <p>
          +{points} points{winners.length > 1 ? ' each' : ''}
        </p>
      )}
    </div>
  )
}

/** Shake-Off: the top shaker across both sides. Quick Draw: the fastest single draw. Landmark: the closest point. */
function mvpOf(state: GameState): { player: GamePlayer; detail: string } | null {
  if (state.kind === 'landmark') {
    const top = bestPoint(state)
    return top && { player: top.player, detail: `${formatDeg(top.degrees)} off` }
  }
  if (state.kind === 'quick_draw') {
    const top = fastestDraw(state)
    return top && { player: top.player, detail: `${formatMs(top.ms)} draw` }
  }
  const top = mvp(state.players)
  return top && top.shakes > 0 ? { player: top, detail: `${top.shakes} shakes` } : null
}

export function MvpLine({ state, meId }: { state: GameState; meId?: string }) {
  const top = mvpOf(state)
  if (!top) return null
  return (
    <p className="mvp">
      🏅 MVP: <strong>{top.player.player_id === meId ? `${top.player.display_name} (you)` : top.player.display_name}</strong> · {top.detail}
    </p>
  )
}
