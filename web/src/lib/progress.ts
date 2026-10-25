/** Level / XP from claim points. Every point earned is 1 XP. */

/** XP needed to finish `level` and reach the next (grows as you climb). */
export function xpToAdvance(level: number): number {
  const safe = Math.max(1, Math.floor(level))
  // L1→2: 50 · L2→3: 75 · L3→4: 100 · …
  return 50 + 25 * (safe - 1)
}

export type Progress = {
  /** Current player level (starts at 1). */
  level: number
  /** XP into the current level. */
  xp: number
  /** XP needed to reach the next level. */
  xpMax: number
  /** 0–1 fill for the XP bar. */
  pct: number
  /** Lifetime XP (= total points claimed). */
  totalXp: number
}

/** Derive level and bar fill from total claim points (1 pt = 1 XP). */
export function progressFromPoints(points: number): Progress {
  const totalXp = Math.max(0, Math.floor(points))
  let level = 1
  let remaining = totalXp
  let need = xpToAdvance(level)
  while (remaining >= need && level < 999) {
    remaining -= need
    level += 1
    need = xpToAdvance(level)
  }
  return {
    level,
    xp: remaining,
    xpMax: need,
    pct: need === 0 ? 1 : remaining / need,
    totalXp,
  }
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
