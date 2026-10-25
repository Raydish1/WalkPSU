import { TargetIcon } from './icons'
import type { DropRow } from '../lib/database.types'
import { DROP_TYPES } from '../lib/campus'

type Props = {
  drop: DropRow | null
  onFocus?: () => void
}

function MissionCard({ drop, onFocus }: Props) {
  if (!drop) {
    return (
      <div className="mission-card glass">
        <div className="mission-card-icon" aria-hidden>
          <TargetIcon size={18} />
        </div>
        <div className="mission-card-body">
          <span className="eyebrow">Current mission</span>
          <strong>Explore campus</strong>
          <p>Select a landmark to start a challenge.</p>
        </div>
      </div>
    )
  }

  return (
    <button type="button" className="mission-card glass mission-card-btn" onClick={onFocus}>
      <div className="mission-card-icon pulse-glow" aria-hidden>
        <TargetIcon size={18} />
      </div>
      <div className="mission-card-body">
        <span className="eyebrow">Current mission</span>
        <strong>
          Visit {drop.title.includes('HUB') ? 'the HUB' : drop.title} and complete a challenge
        </strong>
        <p>
          {DROP_TYPES[drop.type].label} · {drop.points} pts
        </p>
      </div>
    </button>
  )
}

export default MissionCard
