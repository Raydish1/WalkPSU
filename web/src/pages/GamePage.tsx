import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import Avatar from '../components/Avatar'
import { ChevronIcon } from '../components/icons'
import { MvpLine, WinnerHeadline } from '../game/Results'
import TugBar, { SideNames } from '../game/TugBar'
import { SIDES, type Phase } from '../game/shakeoff'
import { useGame } from '../game/useGame'
import { useShakeBroadcast } from '../game/useShakeBroadcast'
import { useShakes } from '../game/useShakes'
import { getDrop, joinGame, startGame } from '../lib/api'
import type { DropRow, GamePlayer, GameState, Side } from '../lib/database.types'
import { distanceM } from '../lib/geo'
import { useClaimRadius } from '../lib/hooks'
import { usePresence } from '../session/presence'
import { useReadySession } from '../session/session'

const seconds = (ms: number) => Math.ceil(ms / 1000)
const NO_LIVE: ReadonlyMap<string, number> = new Map()
const sideStyle = (side: Side) => ({ '--side': SIDES[side].color, '--side-ink': SIDES[side].ink }) as CSSProperties
const vibrate = (pattern: number | number[]) => navigator.vibrate?.(pattern)

/** A player's Shake-Off: join → lobby → countdown → shake → winner. /game/:dropId (?key= when arriving by QR). */
function GamePage() {
  const { dropId = '' } = useParams()
  const [params] = useSearchParams()
  const key = params.get('key')
  const { player, isAdmin } = useReadySession()
  const { state, phase, error, refresh } = useGame(dropId)
  const [drop, setDrop] = useState<DropRow | null>(null)

  useEffect(() => {
    getDrop(dropId).then(setDrop, console.error)
  }, [dropId])

  const me = state?.players.find((p) => p.player_id === player.id) ?? null
  const playing = phase.kind === 'playing' && !!me?.side
  const shakes = useShakes(playing)
  const live = useShakeBroadcast(dropId, me ? { playerId: player.id, count: shakes.count, active: playing } : null)

  // Buzz and toast once as the game starts and once at the result.
  const buzzed = useRef<string | null>(null)
  const points = drop?.points
  useEffect(() => {
    if (!me) return
    if (phase.kind === 'playing' && buzzed.current !== 'start') {
      buzzed.current = 'start'
      vibrate(400)
      toast('Shake-Off started', { id: `start-${dropId}`, description: 'Shake as fast as you can!', duration: 2500 })
    } else if (phase.kind === 'finished' && buzzed.current !== 'end') {
      buzzed.current = 'end'
      vibrate([150, 80, 150, 80, 300])
      const won = me.side === phase.winner
      const result = won ? toast.success : toast
      result(won ? 'You won the Shake-Off!' : `${SIDES[phase.winner].label} won the Shake-Off`, {
        id: `result-${dropId}`,
        description: won && points !== undefined ? `+${points} points` : 'Get them next time.',
      })
    }
  }, [phase, me, dropId, points])

  if (!state) {
    return (
      <section className="page stack game-lobby">
        <BackToMap />
        <p className="muted">{error ?? 'Loading Shake-Off…'}</p>
      </section>
    )
  }

  const title = drop?.title ?? 'Shake-Off'
  const side = me?.side ? SIDES[me.side] : null

  if (phase.kind === 'finished') {
    const won = me?.side === phase.winner
    return (
      <section className="game-screen game-result" style={sideStyle(phase.winner)}>
        <p className="game-eyebrow">
          {title} · {SIDES[phase.winner].label} wins
        </p>
        <WinnerHeadline players={state.players} winner={phase.winner} points={drop?.points} className="game-winners" />
        {me && <p className="game-big">{won ? 'You won! 🎉' : 'So close. Get them next time.'}</p>}
        <MvpLine players={state.players} meId={player.id} />
        <TugBar players={state.players} live={NO_LIVE} meId={player.id} />
        <Link className="button" to="/">
          Back to map
        </Link>
      </section>
    )
  }

  if (phase.kind === 'playing' || phase.kind === 'tallying') {
    if (!me?.side) return <Spectating title={title} phase={phase} players={state.players} live={live} />
    return (
      <section className="game-screen" style={{ '--side': side!.color, '--side-ink': side!.ink } as CSSProperties}>
        <div className="game-top">
          <span className="side-chip">You’re {side!.label}</span>
          {phase.kind === 'playing' && <p className="game-timer">{seconds(phase.remainingMs)}s</p>}
        </div>
        <div className="game-hero">
          {phase.kind === 'playing' ? <h1 className="game-huge is-shaking">SHAKE!</h1> : <h1 className="game-huge">Counting…</h1>}
          <p className="game-count">{shakes.count}</p>
          <span className="game-count-label">{shakes.count === 1 ? 'shake' : 'shakes'}</span>
        </div>
        <TugBar players={state.players} live={live} meId={player.id} />
        {!shakes.motionReady && phase.kind === 'playing' && (
          <button className="button primary game-tap" onClick={shakes.tap}>
            Motion is off: tap here as fast as you can!
          </button>
        )}
      </section>
    )
  }

  // Lobby (or nobody has joined yet).
  const startsIn = phase.kind === 'lobby' ? phase.startsInMs : null
  return (
    <section className="page stack game-lobby">
      <BackToMap />
      <p className="game-eyebrow">Shake-Off · {drop?.points ?? '…'} pts to every winner</p>
      <h1>{title}</h1>
      {startsIn !== null ? (
        <p className="game-countdown" role="timer">
          <span>Starting in</span>
          <strong>{seconds(startsIn)}</strong>
        </p>
      ) : (
        <p className="muted">
          Starts automatically at {state.settings.auto_start_players} players, or when an admin taps Start. Teams are picked at
          random when it begins.
        </p>
      )}
      {me ? (
        <MotionGate shakes={shakes} />
      ) : (
        <JoinButton dropId={dropId} drop={drop} code={key} onJoined={refresh} />
      )}
      {state.players.some((p) => p.side) ? (
        <div className="lobby-sides">
          {(['blue', 'white'] as const).map((s) => (
            <div key={s} className="lobby-side" style={sideStyle(s)}>
              <strong>{SIDES[s].label}</strong>
              <SideNames players={state.players} side={s} live={NO_LIVE} meId={player.id} />
            </div>
          ))}
        </div>
      ) : (
        <Roster players={state.players} meId={player.id} />
      )}
      {isAdmin && <AdminStart dropId={dropId} state={state} startsIn={startsIn} onStarted={refresh} />}
      {error && <p className="error">{error}</p>}
      <Link className="button plain" to={`/battle/${dropId}`}>
        Open the big-screen view
      </Link>
    </section>
  )
}

/** The lobby is full-screen (no tab bar), so it needs its own way out. Leaving keeps your spot in the game. */
function BackToMap() {
  return (
    <Link className="back-link" to="/">
      <ChevronIcon className="back-link-icon" />
      Map
    </Link>
  )
}

function JoinButton({ dropId, drop, code, onJoined }: { dropId: string; drop: DropRow | null; code: string | null; onJoined: () => void }) {
  const { position } = usePresence()
  const radius = useClaimRadius()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const distance = drop && position ? distanceM(position.coords.latitude, position.coords.longitude, drop.lat, drop.lng) : null
  const inRange = code !== null || (radius !== null && distance !== null && distance <= radius)

  async function join() {
    setBusy(true)
    setMessage(null)
    try {
      await joinGame(dropId, code !== null ? { code } : { lat: position!.coords.latitude, lng: position!.coords.longitude })
      onJoined()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack-sm">
      <button className="button primary" onClick={join} disabled={busy || !inRange}>
        {busy ? 'Joining…' : 'Join the Shake-Off'}
      </button>
      {!inRange && (
        <span className="muted">
          {distance === null ? 'Waiting for GPS…' : `${Math.round(distance)} m away. Get within ${radius ?? '…'} m, or scan the drop's QR code.`}
        </span>
      )}
      {message && <span className="error">{message}</span>}
    </div>
  )
}

function MotionGate({ shakes }: { shakes: ReturnType<typeof useShakes> }) {
  if (shakes.permission === 'needs-tap') {
    return (
      <button className="button primary" onClick={shakes.requestPermission}>
        Tap to enable motion
      </button>
    )
  }
  if (shakes.permission === 'denied') {
    return <p className="card muted">Motion access was denied, so you’ll tap instead. To shake, allow motion in Settings › Safari and reload.</p>
  }
  if (shakes.permission === 'unsupported') return <p className="card"><strong>You’re in!</strong> <span className="muted">No motion sensor found, so you’ll tap instead.</span></p>
  return <p className="card"><strong>You’re in!</strong> <span className="muted">Hold your phone tight. When it starts, shake it as fast as you can.</span></p>
}

function Roster({ players, meId }: { players: GamePlayer[]; meId: string }) {
  return (
    <div className="stack-sm">
      <strong>{players.length === 0 ? 'Nobody’s here yet. Be the first!' : `${players.length} joined`}</strong>
      <ul className="roster">
        {players.map((p) => (
          <li key={p.player_id}>
            <Avatar name={p.display_name} color={p.color} />
            <span>
              {p.display_name}
              {p.player_id === meId && <span className="muted"> (you)</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AdminStart({ dropId, state, startsIn, onStarted }: { dropId: string; state: GameState; startsIn: number | null; onStarted: () => void }) {
  const [message, setMessage] = useState<string | null>(null)
  const soonest = state.settings.admin_start_delay_seconds * 1000
  if (startsIn !== null && startsIn <= soonest) return null
  return (
    <div className="stack-sm">
      <button
        className="button"
        disabled={state.players.length < 2}
        onClick={() => startGame(dropId).then(onStarted, (e: Error) => setMessage(e.message))}
      >
        Admin: start now ({state.settings.admin_start_delay_seconds}s countdown)
      </button>
      {state.players.length < 2 && <span className="muted">Needs at least 2 players.</span>}
      {message && <span className="error">{message}</span>}
    </div>
  )
}

function Spectating({ title, phase, players, live }: { title: string; phase: Phase; players: GamePlayer[]; live: ReadonlyMap<string, number> }) {
  return (
    <section className="page stack game-lobby">
      <BackToMap />
      <p className="game-eyebrow">{title}</p>
      <h1>This Shake-Off already started</h1>
      {phase.kind === 'playing' && (
        <p className="game-countdown" role="timer">
          <span>Time left</span>
          <strong>{seconds(phase.remainingMs)}</strong>
        </p>
      )}
      <TugBar players={players} live={live} />
      <Link className="button" to="/">
        Back to map
      </Link>
    </section>
  )
}

export default GamePage
