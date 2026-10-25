import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useLeaderboard } from '../lib/hooks'
import { useReadySession } from '../session/session'

function ordinal(n: number) {
  const tail = n % 100
  if (tail >= 11 && tail <= 13) return `${n}th`
  if (n % 10 === 1) return `${n}st`
  if (n % 10 === 2) return `${n}nd`
  if (n % 10 === 3) return `${n}rd`
  return `${n}th`
}

/** Once, when a new claim moves the signed-in player up: name the person now immediately below them. */
function PassToast() {
  const { player } = useReadySession()
  const { data: scores } = useLeaderboard()
  const seen = useRef<number | null>(null)

  useEffect(() => {
    const index = scores.findIndex((row) => row.player_id === player.id)
    if (index < 0) return
    const previous = seen.current
    seen.current = index
    if (previous === null || index >= previous) return
    const below = scores[index + 1]
    if (!below) return
    toast(`You passed ${below.display_name}. You’re ${ordinal(index + 1)}.`, { id: `pass-${player.id}-${index}` })
  }, [scores, player.id])

  return null
}

export default PassToast
