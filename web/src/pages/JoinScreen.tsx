import { useState, type FormEvent } from 'react'
import { useSession } from '../session/session'

function JoinScreen() {
  const session = useSession()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session.status === 'loading') return <div className="center-screen">Loading…</div>
  if (session.status === 'error') return <div className="center-screen">Something went wrong: {session.message}</div>
  if (session.status === 'signed-out') {
    return (
      <div className="center-screen">
        <h1>WalkPSU</h1>
        <p className="muted">Race across campus to claim drops and capture buildings.</p>
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
    setBusy(true)
    setError(null)
    try {
      await join(name.trim())
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form className="page stack" onSubmit={submit}>
      <h1>Join the game</h1>
      <p className="muted">Race across campus to claim drops and capture buildings. You’ll get your own map color.</p>
      <label className="stack-sm">
        Your name
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} required />
      </label>
      {error && <p className="error">{error}</p>}
      <button className="button primary" disabled={busy || !name.trim()}>
        {busy ? 'Joining…' : 'Start playing'}
      </button>
    </form>
  )
}

export default JoinScreen
