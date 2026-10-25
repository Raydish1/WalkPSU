import type { CSSProperties } from 'react'
import { progressFromPoints, squadFromColor } from '../lib/progress'
import type { PlayerRow } from '../lib/database.types'

type Props = {
  player: PlayerRow
  points: number
  claims: number
}

function PlayerHud({ player, points, claims }: Props) {
  const { level, xp, xpMax, pct } = progressFromPoints(points)
  const squad = squadFromColor(player.color)
  const initial = player.display_name.trim().charAt(0).toUpperCase() || '?'

  return (
    <div className="player-hud panel glow-soft" style={{ '--team': player.color } as CSSProperties}>
      <div className="player-hud-avatar" aria-hidden>
        {initial}
      </div>
      <div className="player-hud-meta">
        <div className="player-hud-top">
          <strong className="player-hud-name">{player.display_name}</strong>
          <span className="team-chip">{squad.short}</span>
        </div>
        <div className="player-hud-stats">
          <span>Lv {level}</span>
          <span className="dot-sep" aria-hidden />
          <span>{claims} claims</span>
        </div>
        <div className="xp-track" role="progressbar" aria-valuenow={xp} aria-valuemin={0} aria-valuemax={xpMax} aria-label="XP progress">
          <div className="xp-fill" style={{ width: `${Math.round(pct * 100)}%` }} />
        </div>
        <span className="xp-label">
          {xp}/{xpMax} XP
        </span>
      </div>
    </div>
  )
}

export default PlayerHud
