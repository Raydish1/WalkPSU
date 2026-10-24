import { createContext, useContext } from 'react'

/** What each opted-in player broadcasts on the "campus" Presence channel. Never written to the database. */
export type LivePlayer = { playerId: string; name: string; color: string; lat: number; lng: number }

export type Presence = {
  position: GeolocationPosition | null
  others: LivePlayer[]
  sharing: boolean
  setSharing: (sharing: boolean) => void
}

export const PresenceContext = createContext<Presence>({ position: null, others: [], sharing: false, setSharing: () => {} })

export function usePresence() {
  return useContext(PresenceContext)
}
