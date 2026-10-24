import { createContext, useContext } from 'react'
import type { PlayerRow } from '../lib/database.types'

export type Session =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'signed-out'; signIn: () => void }
  | { status: 'joining'; join: (displayName: string) => Promise<void>; signOut: () => void }
  | {
      status: 'ready'
      player: PlayerRow
      isAdmin: boolean
      setPlayer: (player: PlayerRow) => void
      signOut: () => void
    }

export const SessionContext = createContext<Session>({ status: 'loading' })

export function useSession() {
  return useContext(SessionContext)
}

export function useReadySession() {
  const session = useSession()
  if (session.status !== 'ready') throw new Error('useReadySession used outside a signed-in screen')
  return session
}
