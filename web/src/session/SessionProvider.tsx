import { useAuth0 } from '@auth0/auth0-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPlayer, getPlayer } from '../lib/api'
import { auth0Config, safeReturnTo } from '../lib/auth0'
import type { PlayerRow } from '../lib/database.types'
import { setAuth0IdTokenGetter, supabase } from '../lib/supabase'
import { SessionContext, type Session } from './session'

type PlayerState = { status: 'loading' } | { status: 'error'; authId: string; message: string } | { status: 'loaded'; authId: string; player: PlayerRow | null }

function usePlayer(authId: string | null) {
  const [state, setState] = useState<PlayerState>({ status: 'loading' })
  useEffect(() => {
    if (!authId) return
    let cancelled = false
    getPlayer(authId).then(
      (player) => !cancelled && setState({ status: 'loaded', authId, player }),
      (e: Error) => !cancelled && setState({ status: 'error', authId, message: e.message }),
    )
    return () => {
      cancelled = true
    }
  }, [authId])
  const setPlayer = useCallback((player: PlayerRow | null) => {
    setState(player ? { status: 'loaded', authId: player.auth_id, player } : { status: 'loading' })
  }, [])
  const current: PlayerState = state.status !== 'loading' && state.authId === authId ? state : { status: 'loading' }
  return [current, setPlayer] as const
}

function toSession(
  state: PlayerState,
  opts: { isAdminClaim: boolean; setPlayer: (p: PlayerRow) => void; join: (name: string) => Promise<void>; signOut: () => Promise<void> },
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
  const [tokenState, setTokenState] = useState<
    { authId: string; status: 'ready' } | { authId: string; status: 'error'; message: string } | null
  >(null)

  useEffect(() => {
    if (!authId) return
    let cancelled = false
    const getToken = async () => {
      const response = await getAccessTokenSilently({ detailedResponse: true })
      if (!response?.id_token) throw new Error('No identity token received. Please log out and log in again.')
      return response.id_token
    }
    setAuth0IdTokenGetter(getToken)
    async function initialize() {
      try {
        const token = await getToken()
        if (cancelled) return
        await supabase.realtime.setAuth(token)
        if (!cancelled) setTokenState({ authId: authId!, status: 'ready' })
      } catch (cause) {
        if (!cancelled) setTokenState({
          authId: authId!, status: 'error',
          message: cause instanceof Error ? cause.message : 'Could not initialize your session.',
        })
      }
    }
    void initialize()
    return () => {
      cancelled = true
      setAuth0IdTokenGetter(null)
    }
  }, [authId, getAccessTokenSilently])

  const tokenReady = tokenState?.authId === authId && tokenState?.status === 'ready'
  const [playerState, setPlayer] = usePlayer(tokenReady ? authId : null)
  const join = useCallback(async (name: string) => setPlayer(await createPlayer(name)), [setPlayer])
  const signOut = useCallback(async () => {
    await logout({ logoutParams: { returnTo: window.location.origin } })
  }, [logout])

  let session: Session
  if (error) session = { status: 'error', message: error.message, signOut }
  else if (isLoading) session = { status: 'loading' }
  else if (!authId) {
    const returnTo = safeReturnTo(window.location.pathname + window.location.search + window.location.hash)
    session = {
      status: 'signed-out',
      signIn: () => loginWithRedirect({ appState: { returnTo } }),
      signUp: () => loginWithRedirect({ appState: { returnTo }, authorizationParams: { screen_hint: 'signup' } }),
    }
  } else if (tokenState?.authId === authId && tokenState.status === 'error') {
    session = { status: 'error', message: tokenState.message, signOut }
  } else if (!tokenReady) session = { status: 'loading' }
  else {
    session = toSession(playerState, { isAdminClaim: user?.app_role === 'admin', setPlayer, join, signOut })
    if (session.status === 'error') session = { ...session, signOut }
  }

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}

function AnonymousSession({ children }: { children: ReactNode }) {
  const [authId, setAuthId] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthId(data.session?.user.id ?? null))
  }, [])

  const [playerState, setPlayer] = usePlayer(authId ?? null)

  const join = useCallback(
    async (name: string) => {
      let id = authId
      if (!id) {
        const { data, error } = await supabase.auth.signInAnonymously()
        if (error || !data.user) throw new Error(error?.message ?? 'Sign-in failed')
        id = data.user.id
      }
      setPlayer(await createPlayer(name))
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
