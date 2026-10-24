import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { useTeams } from '../lib/hooks'
import { useReadySession } from '../session/session'

function ProfilePage() {
  const { player, isAdmin, signOut } = useReadySession()
  const team = useTeams().find((t) => t.id === player.team_id)

  return (
    <section className="page stack">
      <h1>{player.display_name}</h1>
      {team && (
        <p className="team-chip" style={{ '--team': team.color } as CSSProperties}>
          {team.name}
        </p>
      )}
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
