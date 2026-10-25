import { Link } from 'react-router'
import { toast } from 'sonner'
import Avatar from '../components/Avatar'
import { ChevronIcon } from '../components/icons'
import { useDiscovery } from '../session/discovery'
import { usePresence } from '../session/presence'
import { useReadySession } from '../session/session'
import { useTrails } from '../session/trail'

const MILE_M = 1609.344

/** "0.42 mi (680 m)" or "1.3 mi (2.1 km)". */
function formatDistance(meters: number) {
  const miles = meters / MILE_M
  const metric = meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`
  return `${miles < 10 ? miles.toFixed(2) : miles.toFixed(1)} mi (${metric})`
}

function ProfilePage() {
  const { player, isAdmin, signOut } = useReadySession()
  const { sharing, setSharing } = usePresence()
  const { segments, distanceM, clearTrail, restoreTrail } = useTrails()
  const { areas, discovered, showFog, setShowFog } = useDiscovery()
  const found = areas.filter((id) => discovered.has(id)).length

  function clear() {
    const saved = segments
    clearTrail()
    toast('Trail cleared', { action: { label: 'Undo', onClick: () => restoreTrail(saved) } })
  }

  return (
    <section className="page stack">
      <div className="profile-head">
        <Avatar name={player.display_name} color={player.color} large />
        <h1>{player.display_name}</h1>
        <span className="chip">{isAdmin ? 'Organizer' : 'Player'}</span>
      </div>

      <div className="card explore-card">
        <ProgressRing value={areas.length ? found / areas.length : 0} />
        <div className="stack-sm">
          <strong className="explore-count">
            🧭 {found} / {areas.length || '…'} areas discovered
          </strong>
          <span className="muted footnote">Walk into a new part of campus to clear its fog.</span>
        </div>
      </div>

      <div className="list">
        <div className="list-row">
          <span className="list-row-main">Distance walked today</span>
          <strong className="stat-value">{formatDistance(distanceM)}</strong>
        </div>
        <label className="toggle-row">
          <span className="stack-sm">
            <strong>Show fog of war</strong>
            <span className="muted footnote">Dims the parts of campus you haven’t visited. Discovery keeps counting when it’s off.</span>
          </span>
          <input type="checkbox" className="toggle" checked={showFog} onChange={(e) => setShowFog(e.target.checked)} />
        </label>
        <label className="toggle-row">
          <span className="stack-sm">
            <strong>Show me on the map</strong>
            <span className="muted footnote">Other players see your name and live location while the app is open. It’s never saved.</span>
          </span>
          <input type="checkbox" className="toggle" checked={sharing} onChange={(e) => setSharing(e.target.checked)} />
        </label>
      </div>

      <div className="list">
        <button className="list-row" onClick={clear} disabled={segments.length === 0}>
          <span className="list-row-main">
            Clear my trail
            <span className="muted footnote">Your trail stays on this phone and resets each day.</span>
          </span>
        </button>
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

const RING_R = 22
const RING_C = 2 * Math.PI * RING_R

function ProgressRing({ value }: { value: number }) {
  return (
    <svg className="progress-ring" viewBox="0 0 56 56" width={56} height={56} role="img" aria-label={`${Math.round(value * 100)}% explored`}>
      <circle cx="28" cy="28" r={RING_R} className="progress-ring-track" />
      <circle cx="28" cy="28" r={RING_R} className="progress-ring-fill" strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - value)} />
      <text x="28" y="28" dominantBaseline="central" textAnchor="middle" className="progress-ring-label">
        {Math.round(value * 100)}%
      </text>
    </svg>
  )
}

export default ProfilePage
