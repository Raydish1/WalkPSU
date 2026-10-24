import { useEffect, useRef, useState } from 'react'
import { submitShakes } from '../lib/api'
import { supabase } from '../lib/supabase'

const BROADCAST_MS = 500
const SUBMIT_MS = 2000

type ShakeMessage = { playerId: string; count: number }

/**
 * Live shake counts over Realtime broadcast (cosmetic: drives the tug-of-war bar on every screen), plus
 * periodic submits to the server, whose capped totals alone decide the winner.
 * Pass `me` only for a participant; spectators (the big screen) just listen.
 */
export function useShakeBroadcast(dropId: string, me: { playerId: string; count: number; active: boolean } | null) {
  const [live, setLive] = useState<ReadonlyMap<string, number>>(new Map())
  const meRef = useRef(me)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    meRef.current = me
  })

  useEffect(() => {
    const channel = supabase.channel(`shakeoff:${dropId}`, { config: { broadcast: { self: false } } })
    channel
      .on('broadcast', { event: 'shakes' }, ({ payload }) => {
        const { playerId, count } = payload as ShakeMessage
        setLive((prev) => (prev.get(playerId) === count ? prev : new Map(prev).set(playerId, count)))
      })
      .subscribe()
    channelRef.current = channel
    return () => {
      channelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [dropId])

  const active = me?.active ?? false
  useEffect(() => {
    if (!active) return
    let lastSent = -1
    const broadcast = setInterval(() => {
      const current = meRef.current
      if (!current || current.count === lastSent) return
      lastSent = current.count
      channelRef.current?.send({ type: 'broadcast', event: 'shakes', payload: { playerId: current.playerId, count: current.count } satisfies ShakeMessage })
    }, BROADCAST_MS)
    const submit = setInterval(() => {
      if (meRef.current) submitShakes(dropId, meRef.current.count).catch(() => {})
    }, SUBMIT_MS)
    return () => {
      clearInterval(broadcast)
      clearInterval(submit)
      // Final report as the game ends; the server accepts it during the grace period.
      if (meRef.current) submitShakes(dropId, meRef.current.count).catch(() => {})
    }
  }, [active, dropId])

  const own = me ? new Map(live).set(me.playerId, me.count) : live
  return own
}
