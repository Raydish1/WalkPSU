/** Derive level / XP from claim points for the HUD. */
const XP_PER_LEVEL = 100

export function progressFromPoints(points: number) {
  const safe = Math.max(0, points)
  const level = Math.floor(safe / XP_PER_LEVEL) + 1
  const xp = safe % XP_PER_LEVEL
  return { level, xp, xpMax: XP_PER_LEVEL, pct: xp / XP_PER_LEVEL }
}

/** Difficulty for outdoor-readable challenge labels. */
export function difficultyForPoints(points: number): 'Easy' | 'Medium' | 'Hard' {
  if (points >= 120) return 'Hard'
  if (points >= 80) return 'Medium'
  return 'Easy'
}

/** Friendly squad label from a player's map color (no permanent teams in the schema). */
export function squadFromColor(color: string): { name: string; short: string } {
  const hex = color.replace('#', '').toLowerCase()
  const r = parseInt(hex.slice(0, 2) || '00', 16)
  const g = parseInt(hex.slice(2, 4) || '00', 16)
  const b = parseInt(hex.slice(4, 6) || '00', 16)
  if (b > r + 30 && b > g + 20) return { name: 'Blue Barrage', short: 'Blue' }
  if (r > 200 && g > 200 && b > 200) return { name: 'White Wave', short: 'White' }
  if (g > r && g > b) return { name: 'Valley Guard', short: 'Green' }
  if (r > 180 && g > 100) return { name: 'Gold Rush', short: 'Gold' }
  if (r > b && r > g) return { name: 'Scarlet Strike', short: 'Red' }
  return { name: 'Nittany Scouts', short: 'Scout' }
}
