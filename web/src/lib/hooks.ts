import { useCallback, useEffect, useState } from 'react'
import { getBuildingControl, getClaimCodes, getDrops, getLeaderboard, getTeams, subscribeToDrops, subscribeToTable } from './api'
import { loadBuildings, type Building } from './buildings'
import type { BuildingControlRow, DropRow, TeamRow, TeamScoreRow } from './database.types'

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
const NO_SCORES: TeamScoreRow[] = []
const NO_CONTROL: BuildingControlRow[] = []
const NO_CODES = new Map<string, string>()
const subscribeToBuildingControl: Subscribe = (onChange) => subscribeToTable('building_control', onChange)

export const useDrops = () => useLiveQuery(getDrops, NO_DROPS)
export const useLeaderboard = () => useLiveQuery(getLeaderboard, NO_SCORES)
export const useClaimCodes = () => useLiveQuery(getClaimCodes, NO_CODES)
export const useBuildingControl = () => useLiveQuery(getBuildingControl, NO_CONTROL, subscribeToBuildingControl)

export function useTeams() {
  const [teams, setTeams] = useState<TeamRow[]>([])
  useEffect(() => {
    getTeams().then(setTeams, console.error)
  }, [])
  return teams
}

export function useBuildings() {
  const [buildings, setBuildings] = useState<Building[]>([])
  useEffect(() => {
    loadBuildings().then(setBuildings, console.error)
  }, [])
  return buildings
}

export function usePosition() {
  const [position, setPosition] = useState<GeolocationPosition | null>(null)
  useEffect(() => {
    if (!navigator.geolocation) return
    const id = navigator.geolocation.watchPosition(setPosition, console.warn, { enableHighAccuracy: true })
    return () => navigator.geolocation.clearWatch(id)
  }, [])
  return position
}
