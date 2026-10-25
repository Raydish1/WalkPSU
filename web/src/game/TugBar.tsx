import type { CSSProperties } from 'react'
import type { GamePlayer, Side } from '../lib/database.types'
import { SIDES, blueShare, sidePlayers, sideTotals } from './shakeoff'

type Props = { players: GamePlayer[]; live: ReadonlyMap<string, number>; meId?: string; big?: boolean }

/** Blue pulls from the left, White from the right; the knot sits at Blue's share of shakes per player. */
function TugBar({ players, live, meId, big = false }: Props) {
  const totals = sideTotals(players, live)
  const share = blueShare(totals)
  return (
    <div className={`tug ${big ? 'tug-big' : ''}`} style={{ '--blue-share': `${share * 100}%`, '--blue-ratio': share } as CSSProperties}>
      <div className="tug-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label="Blue's share">
        <div className="tug-fill">
          <div className="tug-blue" style={{ background: SIDES.blue.color }} />
        </div>
        <div className="tug-rail">
          <div className="tug-knot" />
        </div>
      </div>
      <div className="tug-labels">
        {(['blue', 'white'] as const).map((side) => (
          <div key={side} className={`tug-side tug-side-${side}`}>
            <span>
              <strong>{SIDES[side].label}</strong> {totals[side].perPlayer.toFixed(1)}/player
            </span>
            <SideNames players={players} side={side} live={live} meId={meId} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function SideNames({ players, side, live, meId }: { players: GamePlayer[]; side: Side; live: ReadonlyMap<string, number>; meId?: string }) {
  return (
    <span className="side-names">
      {sidePlayers(players, side, live).map((p, i) => (
        <span key={p.player_id}>
          {i > 0 && ', '}
          {p.player_id === meId ? <mark className="me">{p.display_name} (you)</mark> : p.display_name}
        </span>
      ))}
    </span>
  )
}

export default TugBar
