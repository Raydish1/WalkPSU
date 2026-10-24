import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { claimDrop } from '../lib/api'

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

  useEffect(() => {
    // StrictMode runs effects twice; a second claim would fail and overwrite the success.
    if (!dropId || !key || attempted.current) return
    attempted.current = true
    claimDrop(dropId, { code: key }).then(
      () => setResult({ status: 'claimed' }),
      (e: Error) => setResult({ status: 'failed', message: e.message }),
    )
  }, [dropId, key])

  return (
    <section className="center-screen">
      {result.status === 'claiming' && <h1>Claiming…</h1>}
      {result.status === 'claimed' && (
        <>
          <h1>Claimed! 🎉</h1>
          <p className="muted">Points and any building go to your team.</p>
        </>
      )}
      {result.status === 'failed' && (
        <>
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
