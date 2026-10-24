import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { usePresence } from '../session/presence'
import { useReadySession } from '../session/session'

function ProfilePage() {
  const { player, isAdmin, signOut } = useReadySession()
  const { sharing, setSharing } = usePresence()

  return (
    <section className="page stack">
      <h1>
        <span className="color-dot" style={{ '--player': player.color } as CSSProperties} aria-hidden />
        {player.display_name}
      </h1>
      <label className="toggle-row">
        <span className="stack-sm">
          <strong>Show me on the map</strong>
          <span className="muted">Other players see your name and live location while the app is open. It's never saved.</span>
        </span>
        <input type="checkbox" className="toggle" checked={sharing} onChange={(e) => setSharing(e.target.checked)} />
      </label>
      {isAdmin && (
        <Link className="button" to="/admin">
          Admin: drop events
        </Link>
      )}
      <button className="button" onClick={signOut}>
        Sign out
      </button>
    </section>
  )
}

export default ProfilePage
