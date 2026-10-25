import { Link } from 'react-router'
import Avatar from '../components/Avatar'
import LevelCard from '../components/LevelCard'
import { ChevronIcon } from '../components/icons'
import { useLeaderboard } from '../lib/hooks'
import { useLevelUpToast } from '../lib/useLevelUp'
import { usePresence } from '../session/presence'
import { useReadySession } from '../session/session'

function ProfilePage() {
  const { player, isAdmin, signOut } = useReadySession()
  const { sharing, setSharing } = usePresence()
  const { data: scores } = useLeaderboard()
  const myScore = scores.find((s) => s.player_id === player.id)
  const points = myScore?.points ?? 0
  const claims = myScore?.claims ?? 0
  useLevelUpToast(points)

  return (
    <section className="page stack">
      <div className="profile-head">
        <Avatar name={player.display_name} color={player.color} large />
        <h1>{player.display_name}</h1>
        <span className="chip">{isAdmin ? 'Organizer' : 'Player'}</span>
      </div>

      <LevelCard points={points} claims={claims} />

      <div className="list">
        <label className="toggle-row">
          <span className="stack-sm">
            <strong>Show me on the map</strong>
            <span className="muted footnote">Other players see your name and live location while the app is open. It’s never saved.</span>
          </span>
          <input type="checkbox" className="toggle" checked={sharing} onChange={(e) => setSharing(e.target.checked)} />
        </label>
      </div>

      <div className="list">
        {isAdmin && (
          <Link className="list-row" to="/admin">
            <span className="list-row-main">Admin: drop events</span>
            <ChevronIcon className="chevron" />
          </Link>
        )}
        <button className="list-row error" onClick={signOut}>
          Sign out
        </button>
      </div>
    </section>
  )
}

export default ProfilePage
