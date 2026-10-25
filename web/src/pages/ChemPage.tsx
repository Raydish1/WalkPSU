import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { ChemPrompt } from '../components/ChemPrompt'
import { answersMatch, generateChemRound, CHEM_NEEDED } from '../chem/problems'
import { claimDrop } from '../lib/api'
import { CAMPUS_CENTER, DROP_TYPES } from '../lib/campus'
import type { DropRow } from '../lib/database.types'
import { distanceM } from '../lib/geo'
import { useClaimRadius, useDrops } from '../lib/hooks'
import { usePresence } from '../session/presence'
import { useReadySession } from '../session/session'

/** Always-available practice run — no Supabase `chemistry` enum / admin drop required. */
export const CHEM_PRACTICE_ID = 'practice'

const PRACTICE_DROP: DropRow = {
  id: CHEM_PRACTICE_ID,
  title: 'Osmond Lab Chemistry',
  type: 'chemistry',
  lat: CAMPUS_CENTER[0],
  lng: CAMPUS_CENTER[1],
  points: 20,
  status: 'active',
  hint_photo_url: null,
  building_num: '0015000',
  created_by: null,
  created_at: new Date().toISOString(),
  expires_at: null,
}

function ChemPage() {
  useReadySession()
  const { dropId = '' } = useParams()
  const [params] = useSearchParams()
  const code = params.get('key')
  const navigate = useNavigate()
  const practice = dropId === CHEM_PRACTICE_ID
  const { data: drops, refresh } = useDrops()
  const radius = useClaimRadius()
  const { position } = usePresence()
  const drop = practice ? PRACTICE_DROP : drops.find((d) => d.id === dropId)

  const [roundSeed, setRoundSeed] = useState(0)
  const problems = useMemo(
    () => generateChemRound(`${dropId}:chem:${roundSeed}`, CHEM_NEEDED),
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

  const problem = problems[index]
  const distance =
    drop && position && !practice ? distanceM(position.coords.latitude, position.coords.longitude, drop.lat, drop.lng) : null
  const inRange = radius !== null && distance !== null && distance <= radius
  const canClaim = practice || Boolean(code) || inRange

  async function finishClaim() {
    if (!drop) return
    if (practice) {
      navigator.vibrate?.(40)
      toast.success('Practice complete!', { description: 'Nice chemistry. Live drops will award real points.' })
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
      toast.success(`Chemistry cleared! +${drop.points} points`, { description: drop.title })
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
    if (!guess.trim()) {
      toast.error('Enter an answer')
      return
    }
    if (!answersMatch(guess, problem.answers)) {
      navigator.vibrate?.([30, 40, 30])
      toast.error('Not quite', { description: 'Check the spelling and try again.' })
      setGuess('')
      return
    }

    const nextSolved = solved + 1
    setSolved(nextSolved)
    setGuess('')
    toast.success('Correct!', { description: `${nextSolved} / ${CHEM_NEEDED}` })

    if (nextSolved >= CHEM_NEEDED) {
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
        <h1>Chemistry challenge</h1>
        <p className="muted">{drops.length === 0 ? 'Loading drop…' : 'That drop wasn’t found.'}</p>
        <Link className="button primary" to={`/chem/${CHEM_PRACTICE_ID}`}>
          Try practice chemistry
        </Link>
        <Link className="button" to="/challenges">
          Back to challenges
        </Link>
      </section>
    )
  }

  if (drop.type !== 'chemistry') {
    return (
      <section className="page stack">
        <h1>Not a chemistry drop</h1>
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
        <Link className="button primary" to={`/chem/${CHEM_PRACTICE_ID}`}>
          Try practice chemistry
        </Link>
      </section>
    )
  }

  return (
    <section className="page stack chem-page">
      <header className="stack-sm">
        <p className="muted footnote" style={{ margin: 0, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--accent)' }}>
          {practice ? 'Practice · Chemistry' : 'Chemistry'}
        </p>
        <h1>{drop.title}</h1>
        <p className="muted">
          Name {CHEM_NEEDED} answers — elements from the periodic table and easy formulas like H₂O.
          {practice ? ' No GPS needed — this run is for testing.' : ` +${drop.points} pts when you finish${canClaim ? '' : ' and you’re in range'}.`}
        </p>
        <div className="math-progress" aria-label={`Solved ${solved} of ${CHEM_NEEDED}`}>
          {Array.from({ length: CHEM_NEEDED }, (_, i) => (
            <span key={i} className="math-progress-dot" data-on={i < solved || undefined} />
          ))}
        </div>
      </header>

      {done && solved >= CHEM_NEEDED ? (
        <div className="card empty-state">
          <strong>{practice ? 'Practice complete' : canClaim ? 'Challenge complete' : 'Solved — get in range'}</strong>
          <p className="muted footnote">
            {practice
              ? 'Ready for a live campus drop once an admin places a Chemistry challenge.'
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
            Problem {Math.min(index + 1, CHEM_NEEDED)} of {CHEM_NEEDED}
          </span>
          <ChemPrompt display={problem.display} prompt={problem.prompt} />
          <label className="field">
            {problem.hint}
            <input
              className="input math-answer"
              value={guess}
              onChange={(e) => setGuess(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              required
            />
          </label>
          <button className="button primary" disabled={busy || !guess.trim()}>
            Check
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

export default ChemPage
