import type { CSSProperties } from 'react'
import { SIDES, blueShare, type SideTotals } from './shakeoff'

/** Blue pulls from the left, White from the right; the knot sits at Blue's share of shakes per player. */
function TugBar({ totals, big = false }: { totals: SideTotals; big?: boolean }) {
  const share = blueShare(totals)
  return (
    <div className={`tug ${big ? 'tug-big' : ''}`} style={{ '--blue-share': `${share * 100}%` } as CSSProperties}>
      <div className="tug-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label="Blue's share">
        <div className="tug-blue" style={{ background: SIDES.blue.color }} />
        <div className="tug-knot" />
      </div>
      <div className="tug-labels">
        <span>
          <strong>{SIDES.blue.label}</strong> {totals.blue.perPlayer.toFixed(1)}/player
        </span>
        <span>
          {totals.white.perPlayer.toFixed(1)}/player <strong>{SIDES.white.label}</strong>
        </span>
      </div>
    </div>
  )
}

export default TugBar
