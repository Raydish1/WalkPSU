import { Link } from 'react-router'
import Avatar from '../components/Avatar'
import { TrophyIcon } from '../components/icons'
import { useLeaderboard } from '../lib/hooks'
import { useReadySession } from '../session/session'

function LeaderboardPage() {
  const { player } = useReadySession()
  const { data: scores, error } = useLeaderboard()

  return (
    <section className="page stack">
      <h1>Leaderboard</h1>
      {error && <p className="error">{error}</p>}
      {scores.length === 0 && !error ? (
        <div className="card empty-state">
          <TrophyIcon size={40} strokeWidth={1.6} />
          <strong>No scores yet</strong>
          <p className="muted footnote">Claim a drop or win a Shake-Off and you’ll be first on the board.</p>
          <Link className="button primary" to="/">
            Find a drop
          </Link>
        </div>
      ) : (
        <ol className="list leaderboard">
          {scores.map((row, i) => (
            <li
              key={row.player_id}
              className={`leaderboard-row ${row.player_id === player.id ? 'is-me' : ''}`}
            >
              <span className={`rank rank-${i + 1}`}>{i + 1}</span>
              <Avatar name={row.display_name} color={row.color} />
              <span className="player-name">
                <span>{row.display_name}</span>
                {row.player_id === player.id && <span className="muted"> (you)</span>}
              </span>
              <span className="score">
                {row.points}
                <span className="muted"> pts</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export default LeaderboardPage
