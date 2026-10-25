import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import type { Building } from '../lib/buildings'
import type { DropRow } from '../lib/database.types'
import { DROP_TYPES } from '../lib/campus'
import { difficultyForPoints } from '../lib/progress'
import { CrossIcon } from './icons'

type Props = {
  building: Building
  drop: DropRow | null
  onClose: () => void
}

function BuildingSheet({ building, drop, onClose }: Props) {
  const points = drop?.points ?? 50
  const difficulty = difficultyForPoints(points)
  const accent = drop ? DROP_TYPES[drop.type].color : 'var(--accent)'
  const challengePath = drop?.type === 'minigame' ? `/game/${drop.id}` : null

  return (
    <aside className="building-sheet glass slide-up" style={{ '--team': accent } as CSSProperties}>
      <header className="building-sheet-head">
        <div>
          <span className="eyebrow">Landmark</span>
          <h2>{building.properties.name}</h2>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close building panel">
          <CrossIcon size={18} />
        </button>
      </header>

      <dl className="building-sheet-grid">
        <div>
          <dt>Status</dt>
          <dd>{drop ? <span className="live-pill">Challenge live</span> : <span className="muted">No active challenge</span>}</dd>
        </div>
        <div>
          <dt>Difficulty</dt>
          <dd>
            <span className={`diff-pill diff-${difficulty.toLowerCase()}`}>{difficulty}</span>
          </dd>
        </div>
        <div>
          <dt>Available points</dt>
          <dd className="points-value">+{points}</dd>
        </div>
        <div>
          <dt>Challenge</dt>
          <dd>{drop ? DROP_TYPES[drop.type].label : 'Explore campus'}</dd>
        </div>
      </dl>

      {challengePath ? (
        <Link className="button primary" to={challengePath}>
          Start Challenge
        </Link>
      ) : drop ? (
        <button type="button" className="button primary" onClick={onClose}>
          Start Challenge
        </button>
      ) : (
        <button type="button" className="button primary" onClick={onClose}>
          Keep exploring
        </button>
      )}
    </aside>
  )
}

export default BuildingSheet
