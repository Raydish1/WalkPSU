import type { CSSProperties } from 'react'
import { useLeaderboard } from '../lib/hooks'
import { useReadySession } from '../session/session'

function LeaderboardPage() {
  const { player } = useReadySession()
  const { data: scores, error } = useLeaderboard()

  return (
    <section className="page stack">
      <h1>Leaderboard</h1>
      {error && <p className="error">{error}</p>}
      <ol className="leaderboard">
        {scores.map((row, i) => (
          <li key={row.player_id} className="leaderboard-row" style={{ '--player': row.color } as CSSProperties}>
            <span className="rank">{i + 1}</span>
            <span className="player-name">
              {row.display_name}
              {row.player_id === player.id && <span className="muted"> (you)</span>}
            </span>
            <span className="score">
              {row.points}
              <span className="muted"> pts</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default LeaderboardPage
