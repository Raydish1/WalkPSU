import { useCallback, useEffect, useState } from 'react'
import { getClaimCodes, getClaimRadius, getDrops, getLeaderboard, subscribeToDrops, subscribeToTable } from './api'
import { loadBuildings, type Building } from './buildings'
import type { DropRow, PlayerScoreRow } from './database.types'

type Subscribe = (onChange: () => void) => () => void

/** Re-runs `load` on mount and whenever `subscribe` reports a change. Call `refresh` after your own writes
 * so the screen updates even if the Realtime socket is down. */
function useLiveQuery<T>(load: () => Promise<T>, initial: T, subscribe: Subscribe = subscribeToDrops) {
  const [data, setData] = useState<T>(initial)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(() => load().then(setData, (e: Error) => setError(e.message)), [load])
  useEffect(() => {
    refresh()
    return subscribe(refresh)
  }, [refresh, subscribe])
  return { data, error, refresh }
}

const NO_DROPS: DropRow[] = []
const NO_SCORES: PlayerScoreRow[] = []
const NO_CODES = new Map<string, string>()
// Not drops: a photo hunt's later finders add claims without changing the drop.
const subscribeToClaims: Subscribe = (onChange) => subscribeToTable('claims', onChange)

export const useDrops = () => useLiveQuery(getDrops, NO_DROPS)
export const useLeaderboard = () => useLiveQuery(getLeaderboard, NO_SCORES, subscribeToClaims)
export const useClaimCodes = () => useLiveQuery(getClaimCodes, NO_CODES)

let claimRadiusPromise: Promise<number> | null = null

/** Null until loaded from the server's claim_radius_m(). */
export function useClaimRadius() {
  const [radius, setRadius] = useState<number | null>(null)
  useEffect(() => {
    claimRadiusPromise ??= getClaimRadius()
    claimRadiusPromise.then(setRadius, (e: Error) => {
      claimRadiusPromise = null
      console.error(e)
    })
  }, [])
  return radius
}

export function useBuildings() {
  const [buildings, setBuildings] = useState<Building[]>([])
  useEffect(() => {
    loadBuildings().then(setBuildings, console.error)
  }, [])
  return buildings
}
