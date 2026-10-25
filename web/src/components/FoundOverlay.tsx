import type { CSSProperties } from 'react'
import { CheckIcon } from './icons'

const CONFETTI = ['#f97316', '#db2777', '#2563eb', '#16a34a', '#facc15', '#7c3aed']
const PIECES = 18

export type Found = { title: string; points: number; first: boolean; reason: string }

/** Full-screen celebration after the AI referee accepts a photo-hunt photo. Tap anywhere to dismiss. */
function FoundOverlay({ found, onClose }: { found: Found; onClose: () => void }) {
  return (
    <div className="found-overlay" role="dialog" aria-modal="true" aria-labelledby="found-title" onClick={onClose}>
      <div className="confetti" aria-hidden>
        {Array.from({ length: PIECES }, (_, i) => (
          <span
            key={i}
            style={{ '--angle': `${(360 / PIECES) * i}deg`, '--distance': `${110 + (i % 3) * 40}px`, background: CONFETTI[i % CONFETTI.length] } as CSSProperties}
          />
        ))}
      </div>
      <div className="found-card">
        <span className="result-badge" data-tone="success">
          <CheckIcon size={44} />
        </span>
        <h1 id="found-title">Found it!</h1>
        <p className="found-points">+{found.points} points</p>
        <p className="muted">
          {found.first
            ? 'First to find it! The pin is now revealed for everyone, and the hunt closes in 7 minutes.'
            : `You found “${found.title}”. Each finder gets half the points of the one before.`}
        </p>
        {found.reason && <p className="muted footnote">Referee: {found.reason}</p>}
        <button className="button primary" onClick={onClose} autoFocus>
          Nice!
        </button>
      </div>
    </div>
  )
}

export default FoundOverlay
