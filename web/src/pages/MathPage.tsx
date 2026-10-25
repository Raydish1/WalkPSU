import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { MathPrompt } from '../components/MathPrompt'
import { claimDrop } from '../lib/api'
import { DROP_TYPES } from '../lib/campus'
import { distanceM } from '../lib/geo'
import { useClaimRadius, useDrops } from '../lib/hooks'
import { generateMathRound, MATH_NEEDED } from '../math/problems'
import { usePresence } from '../session/presence'
import { useReadySession } from '../session/session'

function MathPage() {
  useReadySession()
  const { dropId = '' } = useParams()
  const [params] = useSearchParams()
  const code = params.get('key')
  const navigate = useNavigate()
  const { data: drops, refresh } = useDrops()
  const radius = useClaimRadius()
  const { position } = usePresence()
  const drop = drops.find((d) => d.id === dropId)

  const problems = useMemo(() => generateMathRound(`${dropId}:math`, MATH_NEEDED), [dropId])
  const [index, setIndex] = useState(0)
  const [guess, setGuess] = useState('')
  const [solved, setSolved] = useState(0)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const problem = problems[index]
  const distance =
    drop && position ? distanceM(position.coords.latitude, position.coords.longitude, drop.lat, drop.lng) : null
  const inRange = radius !== null && distance !== null && distance <= radius
  const canClaim = Boolean(code) || inRange

  async function finishClaim() {
    if (!drop) return
    setBusy(true)
    try {
      const proof = code
        ? { code }
        : position
          ? { lat: position.coords.latitude, lng: position.coords.longitude }
          : null
      if (!proof) throw new Error('Waiting for GPS… get in range or scan the drop’s QR code.')
      await claimDrop(drop.id, proof)
      navigator.vibrate?.(40)
      toast.success(`Math cleared! +${drop.points} points`, { description: drop.title })
      refresh()
      setDone(true)
    } catch (e) {
      toast.error('Couldn’t claim', { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!problem || busy || done) return
    const value = Number(guess.trim())
    if (!Number.isFinite(value)) {
      toast.error('Enter a number')
      return
    }
    if (value !== problem.answer) {
      navigator.vibrate?.([30, 40, 30])
      toast.error('Not quite', { description: 'Try another pass at the mental math.' })
      setGuess('')
      return
    }

    const nextSolved = solved + 1
    setSolved(nextSolved)
    setGuess('')
    toast.success('Correct!', { description: `${nextSolved} / ${MATH_NEEDED}` })

    if (nextSolved >= MATH_NEEDED) {
      if (!canClaim) {
        toast.message('Problems solved', { description: 'Get in range (or scan the QR) to cash in the points.' })
        setDone(true)
        return
      }
      void finishClaim()
      return
    }
    setIndex((i) => i + 1)
  }

  if (!drop) {
    return (
      <section className="page stack">
        <h1>Math challenge</h1>
        <p className="muted">Loading drop…</p>
        <Link className="button" to="/challenges">
          Back to challenges
        </Link>
      </section>
    )
  }

  if (drop.type !== 'math') {
    return (
      <section className="page stack">
        <h1>Not a math drop</h1>
        <p className="muted">This challenge is a {DROP_TYPES[drop.type]?.label ?? drop.type}.</p>
        <Link className="button primary" to="/">
          Open map
        </Link>
      </section>
    )
  }

  if (drop.status !== 'active') {
    return (
      <section className="page stack">
        <h1>Already claimed</h1>
        <p className="muted">{drop.title} is no longer available.</p>
        <Link className="button primary" to="/challenges">
          More challenges
        </Link>
      </section>
    )
  }

  return (
    <section className="page stack math-page">
      <header className="stack-sm">
        <p className="muted footnote" style={{ margin: 0, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--accent)' }}>
          Mental math
        </p>
        <h1>{drop.title}</h1>
        <p className="muted">
          Solve {MATH_NEEDED} problems (−, ÷, √, fractions). Answers are whole numbers. +{drop.points} pts when you finish
          {canClaim ? '' : ' and you’re in range'}.
        </p>
        <div className="math-progress" aria-label={`Solved ${solved} of ${MATH_NEEDED}`}>
          {Array.from({ length: MATH_NEEDED }, (_, i) => (
            <span key={i} className="math-progress-dot" data-on={i < solved || undefined} />
          ))}
        </div>
      </header>

      {done && solved >= MATH_NEEDED ? (
        <div className="card empty-state">
          <strong>{canClaim || drop.status !== 'active' ? 'Challenge complete' : 'Solved — get in range'}</strong>
          <p className="muted footnote">
            {canClaim
              ? 'Points are on the board. Keep exploring campus.'
              : `Move within ${radius ?? '…'} m of the drop or scan its QR, then tap claim.`}
          </p>
          {!canClaim && (
            <button className="button primary" disabled={busy || !canClaim} onClick={() => void finishClaim()}>
              {busy ? 'Claiming…' : 'Claim points'}
            </button>
          )}
          <button className="button" onClick={() => navigate('/challenges')}>
            Back to challenges
          </button>
        </div>
      ) : problem ? (
        <form className="card stack" onSubmit={submit}>
          <span className="muted footnote">
            Problem {Math.min(index + 1, MATH_NEEDED)} of {MATH_NEEDED}
          </span>
          <MathPrompt parts={problem.parts} prompt={problem.prompt} />
          <label className="field">
            Your answer
            <input
              className="input math-answer"
              inputMode="numeric"
              pattern="-?[0-9]*"
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              autoComplete="off"
              autoFocus
              required
            />
          </label>
          <button className="button primary" disabled={busy || !guess.trim()}>
            Check
          </button>
          <p className="muted footnote">
            {code
              ? 'QR unlocked — finish the set to claim from here.'
              : inRange
                ? 'You’re in range to claim when you finish.'
                : distance === null
                  ? 'Waiting for GPS…'
                  : `${Math.round(distance)} m away · need ≤ ${radius ?? '…'} m (or scan QR).`}
          </p>
        </form>
      ) : null}
    </section>
  )
}

export default MathPage
