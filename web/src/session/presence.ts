import { createContext, useContext } from 'react'

/** What each opted-in player broadcasts on the "campus" Presence channel. Never written to the database. */
export type LivePlayer = { playerId: string; name: string; color: string; lat: number; lng: number }

/** Called on every GPS fix and every Presence sync, for code that accumulates them (trails, discovery). */
export type PresenceListener = { position?: (position: GeolocationPosition) => void; others?: (others: LivePlayer[]) => void }

export type Presence = {
  position: GeolocationPosition | null
  others: LivePlayer[]
  sharing: boolean
  setSharing: (sharing: boolean) => void
  /** Returns an unsubscribe function. */
  subscribe: (listener: PresenceListener) => () => void
}

export const PresenceContext = createContext<Presence>({ position: null, others: [], sharing: false, setSharing: () => {}, subscribe: () => () => {} })

export function usePresence() {
  return useContext(PresenceContext)
}
