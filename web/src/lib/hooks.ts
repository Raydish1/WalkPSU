import { useCallback, useEffect, useState } from 'react'
import { getBuildingControl, getClaimCodes, getClaimRadius, getDrops, getLeaderboard, getPlayers, subscribeToDrops, subscribeToTable } from './api'
import { loadBuildings, type Building } from './buildings'
import type { BuildingControlRow, DropRow, PlayerRow, PlayerScoreRow } from './database.types'

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
const NO_CONTROL: BuildingControlRow[] = []
const NO_PLAYERS: PlayerRow[] = []
const NO_CODES = new Map<string, string>()
const subscribeToBuildingControl: Subscribe = (onChange) => subscribeToTable('building_control', onChange)

export const useDrops = () => useLiveQuery(getDrops, NO_DROPS)
export const useLeaderboard = () => useLiveQuery(getLeaderboard, NO_SCORES)
export const useClaimCodes = () => useLiveQuery(getClaimCodes, NO_CODES)
export const useBuildingControl = () => useLiveQuery(getBuildingControl, NO_CONTROL, subscribeToBuildingControl)
/** Refetched on every capture, so a newly joined player's color is known by the time they own a building. */
export const usePlayers = () => useLiveQuery(getPlayers, NO_PLAYERS, subscribeToBuildingControl)

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
