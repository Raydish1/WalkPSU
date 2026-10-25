import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { CheckIcon, CrossIcon } from '../components/icons'
import { claimDrop, getDrop } from '../lib/api'

type Result = { status: 'claiming' } | { status: 'claimed' } | { status: 'failed'; message: string }

/** Landing page for a drop's QR code: /claim/:dropId?key=<claim code>. */
function ClaimPage() {
  const { dropId } = useParams()
  const [params] = useSearchParams()
  const key = params.get('key')
  const [result, setResult] = useState<Result>(
    dropId && key ? { status: 'claiming' } : { status: 'failed', message: 'This QR link is incomplete.' },
  )
  const attempted = useRef(false)
  const navigate = useNavigate()

  useEffect(() => {
    // StrictMode runs effects twice; a second claim would fail and overwrite the success.
    if (!dropId || !key || attempted.current) return
    attempted.current = true
    getDrop(dropId)
      .then((drop) => {
        // Mini-game QR opens the Shake-Off lobby; math/chem QR opens the puzzle (claim after solving).
        if (drop?.type === 'minigame') return navigate(`/game/${dropId}?key=${encodeURIComponent(key)}`, { replace: true })
        if (drop?.type === 'math') return navigate(`/math/${dropId}?key=${encodeURIComponent(key)}`, { replace: true })
        if (drop?.type === 'chemistry') return navigate(`/chem/${dropId}?key=${encodeURIComponent(key)}`, { replace: true })
        return claimDrop(dropId, { code: key }).then(() => setResult({ status: 'claimed' }))
      })
      .catch((e: Error) => setResult({ status: 'failed', message: e.message }))
  }, [dropId, key, navigate])

  return (
    <section className="center-screen">
      {result.status === 'claiming' && (
        <>
          <span className="result-badge">
            <span className="spinner" aria-hidden />
          </span>
          <h1>Claiming…</h1>
        </>
      )}
      {result.status === 'claimed' && (
        <>
          <span className="result-badge" data-tone="success">
            <CheckIcon size={44} />
          </span>
          <h1>Claimed!</h1>
          <p className="muted">The points are yours.</p>
        </>
      )}
      {result.status === 'failed' && (
        <>
          <span className="result-badge" data-tone="error">
            <CrossIcon size={40} />
          </span>
          <h1>Couldn’t claim</h1>
          <p className="muted">{result.message}</p>
        </>
      )}
      <Link className="button primary" to="/">
        Back to map
      </Link>
    </section>
  )
}

export default ClaimPage
