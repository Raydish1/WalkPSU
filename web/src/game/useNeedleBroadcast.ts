import { useEffect, useRef, useState } from 'react'
import { submitDodges } from '../lib/api'
import { supabase } from '../lib/supabase'

const BROADCAST_MS = 200
const SUBMIT_MS = 2000

export type NeedleSample = { x: number; count: number; eliminated: boolean }

type MoveMessage = NeedleSample & { playerId: string }

/**
 * Live dodge counts and x positions for the projector. Cosmetic only: the winner is the capped
 * `submit_dodges` total, and a hit freezes that total on the server.
 */
export function useNeedleBroadcast(dropId: string, me: { playerId: string; active: boolean; report: boolean } | null, sample: { current: NeedleSample }) {
  const [live, setLive] = useState<ReadonlyMap<string, NeedleSample>>(new Map())
  const meRef = useRef(me)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    meRef.current = me
  })

  useEffect(() => {
    const channel = supabase.channel(`needlerain:${dropId}`, { config: { broadcast: { self: false } } })
    channel
      .on('broadcast', { event: 'move' }, ({ payload }) => {
        const { playerId, x, count, eliminated } = payload as MoveMessage
        setLive((prev) => new Map(prev).set(playerId, { x, count, eliminated }))
      })
      .subscribe()
    channelRef.current = channel
    return () => {
      channelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [dropId])

  const active = me?.active ?? false
  const report = me?.report ?? false
  useEffect(() => {
    if (!active && !report) return
    let latest = sample.current
    const broadcast = setInterval(() => {
      latest = sample.current
      const current = meRef.current
      if (!active || !current) return
      const payload: MoveMessage = { playerId: current.playerId, ...latest }
      channelRef.current?.send({ type: 'broadcast', event: 'move', payload })
    }, BROADCAST_MS)
    const submit = report
      ? setInterval(() => {
          submitDodges(dropId, latest.count, latest.eliminated).catch(() => {})
        }, SUBMIT_MS)
      : null
    return () => {
      clearInterval(broadcast)
      if (submit) clearInterval(submit)
      if (report) submitDodges(dropId, latest.count, latest.eliminated).catch(() => {})
    }
  }, [active, report, dropId, sample])

  return live
}
