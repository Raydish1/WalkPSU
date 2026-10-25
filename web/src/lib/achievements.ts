/** Badges earned by reaching a point total. Worked out from each player's score, so nothing is stored. */
export const ACHIEVEMENTS = [
  { points: 100, emoji: '🌱', name: 'Touch Grass', blurb: 'Reached 100 points. Go outside.' },
  { points: 500, emoji: '🎬', name: 'Main Character', blurb: 'Reached 500 points. Everyone is watching.' },
  { points: 1000, emoji: '😎', name: 'Chad', blurb: 'Reached 1,000 points. Effortlessly.' },
]

/** The badges a score has earned, lowest first. */
export function achievementsFor(points: number) {
  return ACHIEVEMENTS.filter((a) => points >= a.points)
}
