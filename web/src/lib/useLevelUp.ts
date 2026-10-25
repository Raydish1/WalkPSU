import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { progressFromPoints } from './progress'

/** Toast when claim points push the player into a new level. */
export function useLevelUpToast(points: number) {
  const prev = useRef<number | null>(null)

  useEffect(() => {
    if (prev.current === null) {
      prev.current = points
      return
    }
    const before = progressFromPoints(prev.current)
    const after = progressFromPoints(points)
    const gained = points - prev.current
    prev.current = points
    if (gained <= 0 || after.level <= before.level) return

    const jumped = after.level - before.level
    toast.success(jumped > 1 ? `Level ${after.level}!` : `Level up — ${after.level}!`, {
      description: `+${gained} XP from your points · ${after.xp}/${after.xpMax} to next`,
    })
  }, [points])
}
