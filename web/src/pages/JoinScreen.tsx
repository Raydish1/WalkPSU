import { useState, type CSSProperties, type FormEvent } from 'react'
import { auth0Config } from '../lib/auth0'
import { useTeams } from '../lib/hooks'
import { useSession } from '../session/session'

function JoinScreen() {
  const session = useSession()
  const teams = useTeams()
  const [name, setName] = useState('')
  const [teamId, setTeamId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function runAuth(action: (() => void) | (() => Promise<void>)) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (session.status === 'loading') return <div className="center-screen" role="status">Loading your session…</div>
  if (session.status === 'error') return (
    <div className="center-screen">
      <h1>Could not finish signing in</h1>
      <p className="error" role="alert">{session.message}</p>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="button primary" onClick={() => window.location.reload()}>Try again</button>
      {session.signOut && <button className="button" disabled={busy} onClick={() => void runAuth(session.signOut)}>Log out</button>}
    </div>
  )
  if (session.status === 'signed-out') {
    return (
      <div className="center-screen auth-screen">
        <div className="auth-card stack">
          <span className="auth-eyebrow">EXPLORE · COMPETE · CONNECT</span>
          <h1>Welcome to WalkPSU</h1>
          <p className="muted">Find campus adventures. Join a team. Make your mark.</p>
          <button className="button primary" disabled={busy} onClick={() => void runAuth(session.signUp ?? session.signIn)}>
            Create an account
          </button>
          <button className="button" disabled={busy} onClick={() => void runAuth(session.signIn)}>
            Log in
          </button>
          {busy && <p className="muted" role="status">Opening secure sign-in…</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <p className="auth-note muted">Secure sign-in with Auth0. Choose your name and team after signing in.</p>
        </div>
      </div>
    )
  }
  if (session.status !== 'joining') return null
  const { join } = session

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!teamId) return
    setBusy(true)
    setError(null)
    try {
      await join(name.trim(), teamId)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form className="page stack onboarding" onSubmit={submit}>
      <h1>{auth0Config ? 'Choose your team' : 'Join the guest demo'}</h1>
      <p className="muted">{auth0Config
        ? 'You are signed in. Pick a display name and team to start exploring.'
        : 'Guest progress belongs to this browser session. Account login and signup become available when Auth0 is configured.'}</p>
      <label className="stack-sm">
        Your name
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} minLength={1} maxLength={32} autoComplete="nickname" required disabled={busy} />
      </label>
      <fieldset className="stack-sm">
        <legend>Pick your team</legend>
        <div className="team-grid">
          {teams.map((team) => (
            <button
              type="button"
              disabled={busy}
              key={team.id}
              className="team-option"
              aria-pressed={teamId === team.id}
              style={{ '--team': team.color } as CSSProperties}
              onClick={() => setTeamId(team.id)}
            >
              {team.name}
            </button>
          ))}
        </div>
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="button primary" disabled={busy || !teamId || !name.trim()}>
        {busy ? 'Joining…' : 'Start playing'}
      </button>
      <button type="button" className="button" disabled={busy} onClick={() => void runAuth(session.signOut)}>
        {auth0Config ? 'Log out / use another account' : 'Reset guest session'}
      </button>
    </form>
  )
}

export default JoinScreen
