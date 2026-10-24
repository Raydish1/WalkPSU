import { useAuth0 } from '@auth0/auth0-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPlayer, getPlayer } from '../lib/api'
import { auth0Config } from '../lib/auth0'
import type { PlayerRow } from '../lib/database.types'
import { setAuth0IdTokenGetter, supabase } from '../lib/supabase'
import { SessionContext, type Session } from './session'

type PlayerState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'loaded'; player: PlayerRow | null }

function usePlayer(authId: string | null) {
  const [state, setState] = useState<PlayerState>({ status: 'loading' })
  useEffect(() => {
    if (!authId) return
    let cancelled = false
    getPlayer(authId).then(
      (player) => !cancelled && setState({ status: 'loaded', player }),
      (e: Error) => !cancelled && setState({ status: 'error', message: e.message }),
    )
    return () => {
      cancelled = true
    }
  }, [authId])
  const setPlayer = useCallback((player: PlayerRow | null) => setState({ status: 'loaded', player }), [])
  return [state, setPlayer] as const
}

function toSession(
  state: PlayerState,
  opts: { isAdminClaim: boolean; setPlayer: (p: PlayerRow) => void; join: (name: string, teamId: string) => Promise<void>; signOut: () => void },
): Session {
  if (state.status !== 'loaded') return state
  if (!state.player) return { status: 'joining', join: opts.join, signOut: opts.signOut }
  return {
    status: 'ready',
    player: state.player,
    isAdmin: opts.isAdminClaim || state.player.is_admin,
    setPlayer: opts.setPlayer,
    signOut: opts.signOut,
  }
}

function Auth0Session({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated, user, error, loginWithRedirect, logout, getAccessTokenSilently } = useAuth0()
  const authId = isAuthenticated ? (user?.sub ?? null) : null
  const [tokenReady, setTokenReady] = useState(false)

  useEffect(() => {
    if (!authId) return
    // Supabase verifies the Auth0 ID token; detailedResponse refreshes it when expired.
    setAuth0IdTokenGetter(async () => (await getAccessTokenSilently({ detailedResponse: true }))?.id_token ?? null)
    supabase.realtime.setAuth().then(() => setTokenReady(true))
  }, [authId, getAccessTokenSilently])

  const [playerState, setPlayer] = usePlayer(tokenReady ? authId : null)
  const join = useCallback(async (name: string, teamId: string) => setPlayer(await createPlayer(name, teamId)), [setPlayer])
  const signOut = useCallback(() => logout({ logoutParams: { returnTo: window.location.origin } }), [logout])

  let session: Session
  if (error) session = { status: 'error', message: error.message }
  else if (isLoading) session = { status: 'loading' }
  else if (!authId) session = { status: 'signed-out', signIn: () => loginWithRedirect() }
  else session = toSession(playerState, { isAdminClaim: user?.app_role === 'admin', setPlayer, join, signOut })

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}

function AnonymousSession({ children }: { children: ReactNode }) {
  const [authId, setAuthId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthId(data.session?.user.id ?? null))
  }, [])

  const [playerState, setPlayer] = usePlayer(authId ?? null)

  const join = useCallback(
    async (name: string, teamId: string) => {
      let id = authId
      if (!id) {
        const { data, error } = await supabase.auth.signInAnonymously()
        if (error || !data.user) throw new Error(error?.message ?? 'Sign-in failed')
        id = data.user.id
      }
      // Create the row before publishing authId so usePlayer's fetch can't race it back to "joining".
      setPlayer(await createPlayer(name, teamId))
      setAuthId(id)
    },
    [authId, setPlayer],
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setPlayer(null)
    setAuthId(null)
  }, [setPlayer])

  let session: Session
  if (authId === undefined) session = { status: 'loading' }
  else if (authId === null) session = { status: 'joining', join, signOut }
  else session = toSession(playerState, { isAdminClaim: false, setPlayer, join, signOut })

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}

export const SessionProvider = auth0Config ? Auth0Session : AnonymousSession
