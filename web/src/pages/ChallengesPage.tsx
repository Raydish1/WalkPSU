import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { StarIcon } from '../components/icons'
import { DROP_TYPES } from '../lib/campus'
import { difficultyForPoints } from '../lib/progress'
import { useDrops } from '../lib/hooks'
import { distanceM } from '../lib/geo'
import { usePresence } from '../session/presence'
import { MATH_PRACTICE_ID } from './MathPage'

function ChallengesPage() {
  const { data: drops, error } = useDrops()
  const { position } = usePresence()

  return (
    <section className="page stack">
      <header>
        <p className="muted footnote" style={{ margin: 0, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--accent)' }}>
          Territory quests
        </p>
        <h1>Challenges</h1>
        <p className="muted">Race to campus landmarks, run challenges, and cash in points.</p>
      </header>

      <div className="card stack-sm" style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <span className="chip" style={{ '--player': DROP_TYPES.math.color } as CSSProperties}>
            <span className="color-dot" aria-hidden />
            Mental math
          </span>
          <span className="diff-pill diff-medium">Practice</span>
        </div>
        <h2 style={{ margin: 0, fontSize: 18 }}>Old Main Mental Math</h2>
        <p className="muted" style={{ margin: 0 }}>
          3 problems · √ − ÷ fractions · no GPS needed
        </p>
        <Link className="button primary" to={`/math/${MATH_PRACTICE_ID}`}>
          Start Challenge
        </Link>
      </div>

      {error && <p className="error">{error}</p>}

      {drops.length === 0 ? (
        <div className="card empty-state">
          <StarIcon size={40} strokeWidth={1.6} />
          <strong>No live campus drops yet</strong>
          <p className="muted footnote">Try the practice math challenge above, or wait for an admin drop.</p>
          <Link className="button" to="/">
            Open map
          </Link>
        </div>
      ) : (
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {drops.map((drop) => {
            const distance =
              position != null
                ? Math.round(distanceM(position.coords.latitude, position.coords.longitude, drop.lat, drop.lng))
                : null
            const difficulty = difficultyForPoints(drop.points)
            const href =
              drop.type === 'minigame' ? `/game/${drop.id}` : drop.type === 'math' ? `/math/${drop.id}` : '/'
            const cta =
              drop.type === 'minigame' || drop.type === 'math' ? 'Start Challenge' : 'View on map'
            return (
              <li key={drop.id} className="card stack-sm" style={{ '--accent-local': DROP_TYPES[drop.type].color, padding: 16 } as CSSProperties}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span className="chip" style={{ '--player': DROP_TYPES[drop.type].color } as CSSProperties}>
                    <span className="color-dot" aria-hidden />
                    {DROP_TYPES[drop.type].label}
                  </span>
                  <span className={`diff-pill diff-${difficulty.toLowerCase()}`}>{difficulty}</span>
                </div>
                <h2 style={{ margin: 0, fontSize: 18 }}>{drop.title}</h2>
                <p className="muted" style={{ margin: 0 }}>
                  +{drop.points} pts
                  {distance !== null ? ` · ${distance} m away` : ''}
                  {drop.type === 'math' ? ' · √ − ÷ fractions' : ''}
                </p>
                <Link className="button primary" to={href}>
                  {cta}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default ChallengesPage
