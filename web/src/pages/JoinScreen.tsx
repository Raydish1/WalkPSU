import { useState, type CSSProperties, type FormEvent } from 'react'
import { useTeams } from '../lib/hooks'
import { useSession } from '../session/session'

function JoinScreen() {
  const session = useSession()
  const teams = useTeams()
  const [name, setName] = useState('')
  const [teamId, setTeamId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session.status === 'loading') return <div className="center-screen">Loading…</div>
  if (session.status === 'error') return <div className="center-screen">Something went wrong: {session.message}</div>
  if (session.status === 'signed-out') {
    return (
      <div className="center-screen">
        <h1>WalkPSU</h1>
        <p className="muted">Race your team across campus to claim drops.</p>
        <button className="button primary" onClick={session.signIn}>
          Log in
        </button>
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
    <form className="page stack" onSubmit={submit}>
      <h1>Join the game</h1>
      <label className="stack-sm">
        Your name
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} required />
      </label>
      <fieldset className="stack-sm">
        <legend>Pick your team</legend>
        <div className="team-grid">
          {teams.map((team) => (
            <button
              type="button"
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
      {error && <p className="error">{error}</p>}
      <button className="button primary" disabled={busy || !teamId || !name.trim()}>
        {busy ? 'Joining…' : 'Start playing'}
      </button>
    </form>
  )
}

export default JoinScreen
