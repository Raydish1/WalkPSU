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
        {scores.map((team, i) => (
          <li key={team.team_id} className="leaderboard-row" style={{ '--team': team.color } as CSSProperties}>
            <span className="rank">{i + 1}</span>
            <span className="team-name">
              {team.name}
              {team.team_id === player.team_id && <span className="muted"> (you)</span>}
            </span>
            <span className="score">
              {team.points}
              <span className="muted"> pts</span>
              <span className="territory">🏛️ {team.buildings}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default LeaderboardPage
