import type { GamePlayer, Side } from '../lib/database.types'
import { joinNames, mvp, sidePlayers } from './shakeoff'

const NO_LIVE: ReadonlyMap<string, number> = new Map()

/** "Rayhan, Alex & Sam win! +30 points each", top shaker first. */
export function WinnerHeadline({ players, winner, points, className }: { players: GamePlayer[]; winner: Side; points?: number; className: string }) {
  const winners = sidePlayers(players, winner, NO_LIVE)
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

/** Top shaker across both sides. */
export function MvpLine({ players, meId }: { players: GamePlayer[]; meId?: string }) {
  const top = mvp(players)
  if (!top || top.shakes === 0) return null
  return (
    <p className="mvp">
      🏅 MVP: <strong>{top.player_id === meId ? `${top.display_name} (you)` : top.display_name}</strong> · {top.shakes} shakes
    </p>
  )
}
