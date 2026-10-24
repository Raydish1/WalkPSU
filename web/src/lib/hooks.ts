import { useEffect, useState } from 'react'
import { getDrops, getLeaderboard, getTeams, subscribeToDrops } from './api'
import type { DropRow, TeamRow, TeamScoreRow } from './database.types'

/** Re-runs `load` on mount and whenever any drop changes (new drop, claim, expiry). */
function useLiveQuery<T>(load: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const refresh = () => load().then(setData, (e: Error) => setError(e.message))
    refresh()
    return subscribeToDrops(refresh)
  }, [load])
  return { data, error }
}

const NO_DROPS: DropRow[] = []
const NO_SCORES: TeamScoreRow[] = []

export const useDrops = () => useLiveQuery(getDrops, NO_DROPS)
export const useLeaderboard = () => useLiveQuery(getLeaderboard, NO_SCORES)

export function useTeams() {
  const [teams, setTeams] = useState<TeamRow[]>([])
  useEffect(() => {
    getTeams().then(setTeams, console.error)
  }, [])
  return teams
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
