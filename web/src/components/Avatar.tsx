import type { CSSProperties } from 'react'

/** A player's map color as a round avatar with their initial. */
function Avatar({ name, color, large = false }: { name: string; color: string; large?: boolean }) {
  return (
    <span className={`avatar ${large ? 'avatar-lg' : ''}`} style={{ '--player': color } as CSSProperties} aria-hidden>
      {[...name.trim()][0]?.toUpperCase() ?? '?'}
    </span>
  )
}

export default Avatar
