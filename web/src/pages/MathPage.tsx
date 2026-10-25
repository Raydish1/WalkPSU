import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { MathPrompt } from '../components/MathPrompt'
import { claimDrop } from '../lib/api'
import { CAMPUS_CENTER, DROP_TYPES } from '../lib/campus'
import type { DropRow } from '../lib/database.types'
import { distanceM } from '../lib/geo'
import { useClaimRadius, useDrops } from '../lib/hooks'
import { generateMathRound, MATH_NEEDED } from '../math/problems'
import { usePresence } from '../session/presence'
import { useReadySession } from '../session/session'

/** Always-available practice run — no Supabase `math` enum / admin drop required. */
export const MATH_PRACTICE_ID = 'practice'

const PRACTICE_DROP: DropRow = {
  id: MATH_PRACTICE_ID,
  title: 'Old Main Mental Math',
  type: 'math',
  lat: CAMPUS_CENTER[0],
  lng: CAMPUS_CENTER[1],
  points: 20,
  status: 'active',
  hint_photo_url: null,
  building_num: '0001000',
  created_by: null,
  created_at: new Date().toISOString(),
  expires_at: null,
}

function MathPage() {
  useReadySession()
  const { dropId = '' } = useParams()
  const [params] = useSearchParams()
  const code = params.get('key')
  const navigate = useNavigate()
  const practice = dropId === MATH_PRACTICE_ID
  const { data: drops, refresh } = useDrops()
  const radius = useClaimRadius()
  const { position } = usePresence()
  const drop = practice ? PRACTICE_DROP : drops.find((d) => d.id === dropId)

  const [roundSeed, setRoundSeed] = useState(0)
  const problems = useMemo(
    () => generateMathRound(`${dropId}:math:${roundSeed}`, MATH_NEEDED),
    [dropId, roundSeed],
  )
  const [index, setIndex] = useState(0)
  const [guess, setGuess] = useState('')
  const [solved, setSolved] = useState(0)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  function playAgain() {
    setRoundSeed((s) => s + 1)
    setIndex(0)
    setGuess('')
    setSolved(0)
    setBusy(false)
    setDone(false)
  }

  function giveUp() {
    toast.message('Challenge skipped', { description: 'No points this time — try again whenever you’re ready.' })
    navigate('/challenges')
  }

  const problem = problems[index]
  const distance =
    drop && position && !practice ? distanceM(position.coords.latitude, position.coords.longitude, drop.lat, drop.lng) : null
  const inRange = radius !== null && distance !== null && distance <= radius
  const canClaim = practice || Boolean(code) || inRange

  async function finishClaim() {
    if (!drop) return
    if (practice) {
      navigator.vibrate?.(40)
      toast.success('Practice complete!', { description: 'Nice mental math. Live drops will award real points.' })
      setDone(true)
      return
    }
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
      toast.success(`Math cleared! +${drop.points} XP`, { description: `${drop.title} · points feed your level` })
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
        <p className="muted">{drops.length === 0 ? 'Loading drop…' : 'That drop wasn’t found.'}</p>
        <Link className="button primary" to={`/math/${MATH_PRACTICE_ID}`}>
          Try practice math
        </Link>
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

  if (!practice && drop.status !== 'active') {
    return (
      <section className="page stack">
        <h1>Already claimed</h1>
        <p className="muted">{drop.title} is no longer available.</p>
        <Link className="button primary" to={`/math/${MATH_PRACTICE_ID}`}>
          Try practice math
        </Link>
      </section>
    )
  }

  return (
    <section className="page stack math-page">
      <header className="stack-sm">
        <p className="muted footnote" style={{ margin: 0, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--accent)' }}>
          {practice ? 'Practice · Mental math' : 'Mental math'}
        </p>
        <h1>{drop.title}</h1>
        <p className="muted">
          Solve {MATH_NEEDED} problems (−, ÷, √, fractions). Answers are whole numbers.
          {practice ? ' No GPS needed — this run is for testing.' : ` +${drop.points} pts when you finish${canClaim ? '' : ' and you’re in range'}.`}
        </p>
        <div className="math-progress" aria-label={`Solved ${solved} of ${MATH_NEEDED}`}>
          {Array.from({ length: MATH_NEEDED }, (_, i) => (
            <span key={i} className="math-progress-dot" data-on={i < solved || undefined} />
          ))}
        </div>
      </header>

      {done && solved >= MATH_NEEDED ? (
        <div className="card empty-state">
          <strong>{practice ? 'Practice complete' : canClaim ? 'Challenge complete' : 'Solved — get in range'}</strong>
          <p className="muted footnote">
            {practice
              ? 'Ready for a live campus drop once an admin places a Mental math challenge.'
              : canClaim
                ? 'Points are on the board. Keep exploring campus.'
                : `Move within ${radius ?? '…'} m of the drop or scan its QR, then tap claim.`}
          </p>
          {!practice && !canClaim && (
            <button className="button primary" disabled={busy || !canClaim} onClick={() => void finishClaim()}>
              {busy ? 'Claiming…' : 'Claim points'}
            </button>
          )}
          <button className="button primary" onClick={playAgain}>
            Play again
          </button>
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
          <button type="button" className="button" disabled={busy} onClick={giveUp}>
            Give up
          </button>
          <p className="muted footnote">
            {practice
              ? 'Practice mode — finish all 3 to complete the run.'
              : code
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
