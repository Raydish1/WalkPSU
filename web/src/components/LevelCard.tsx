import { progressFromPoints } from '../lib/progress'

type Props = {
  points: number
  claims: number
}

/** Profile / summary card: points feed XP 1:1 into levels. */
function LevelCard({ points, claims }: Props) {
  const { level, xp, xpMax, pct, totalXp } = progressFromPoints(points)

  return (
    <div className="card stack-sm level-card" style={{ padding: 16 }}>
      <div className="level-card-top">
        <div>
          <p className="muted footnote" style={{ margin: 0, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--accent)' }}>
            Rank
          </p>
          <p className="level-card-level">Level {level}</p>
        </div>
        <div className="level-card-side">
          <strong>{points}</strong>
          <span className="muted footnote">points</span>
        </div>
      </div>
      <div className="xp-track" role="progressbar" aria-valuenow={xp} aria-valuemin={0} aria-valuemax={xpMax} aria-label="XP progress">
        <div className="xp-fill" style={{ width: `${Math.round(pct * 100)}%` }} />
      </div>
      <p className="muted footnote" style={{ margin: 0 }}>
        {xp}/{xpMax} XP to Level {level + 1} · {totalXp} XP earned · {claims} claims
      </p>
      <p className="muted footnote" style={{ margin: 0 }}>
        Every point you claim is 1 XP. Finish challenges and Shake-Offs to level up.
      </p>
    </div>
  )
}

export default LevelCard
