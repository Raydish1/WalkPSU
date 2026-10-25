import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import Avatar from '../components/Avatar'
import { ChevronIcon } from '../components/icons'
import GameIcon from '../game/GameIcon'
import { MINIGAMES } from '../game/kinds'
import { useCompass, type CompassStatus } from '../game/compass'
import { LandmarkBoard, LandmarkPlay, LandmarkSides } from '../game/LandmarkScreens'
import { DrawSides, QuickDrawPlay, RoundBoard } from '../game/QuickDrawScreens'
import { MvpLine, WinnerHeadline } from '../game/Results'
import TugBar, { SideNames } from '../game/TugBar'
import { SIDES, type Phase } from '../game/shakeoff'
import { useGame } from '../game/useGame'
import { useShakeBroadcast } from '../game/useShakeBroadcast'
import { useShakes } from '../game/useShakes'
import { getDrop, joinGame, startGame } from '../lib/api'
import type { DropRow, GamePlayer, GameState, MinigameKind, Side } from '../lib/database.types'
import { distanceM } from '../lib/geo'
import { useClaimRadius } from '../lib/hooks'
import { usePresence } from '../session/presence'
import { useReadySession } from '../session/session'

const seconds = (ms: number) => Math.ceil(ms / 1000)
const NO_LIVE: ReadonlyMap<string, number> = new Map()
const sideStyle = (side: Side) => ({ '--side': SIDES[side].color, '--side-ink': SIDES[side].ink }) as CSSProperties
const vibrate = (pattern: number | number[]) => navigator.vibrate?.(pattern)

/** A player's mini-game: join → lobby → countdown → play → winner. /game/:dropId (?key= when arriving by QR). */
function GamePage() {
  const { dropId = '' } = useParams()
  const [params] = useSearchParams()
  const key = params.get('key')
  const { player, isAdmin } = useReadySession()
  const { state, phase, error, refresh, offset, serverNow } = useGame(dropId)
  const [drop, setDrop] = useState<DropRow | null>(null)

  useEffect(() => {
    getDrop(dropId).then(setDrop, console.error)
  }, [dropId])

  const me = state?.players.find((p) => p.player_id === player.id) ?? null
  const kind = state?.kind ?? drop?.game ?? 'shake_off'
  const game = MINIGAMES[kind]
  const shaking = kind === 'shake_off' && phase.kind === 'playing' && !!me?.side
  const shakes = useShakes(shaking)
  const live = useShakeBroadcast(dropId, me && kind === 'shake_off' ? { playerId: player.id, count: shakes.count, active: shaking } : null)
  // One compass for the lobby check and the game, so iOS asks for permission once.
  const compass = useCompass()

  // Buzz and toast once as the game starts and once at the result.
  const buzzed = useRef<string | null>(null)
  const points = drop?.points
  useEffect(() => {
    if (!me) return
    if (phase.kind === 'playing' && buzzed.current !== 'start') {
      buzzed.current = 'start'
      vibrate(400)
      toast(`${game.name} started`, {
        id: `start-${dropId}`,
        description: { shake_off: 'Shake as fast as you can!', quick_draw: 'Hold still and wait for the flash.', landmark: 'Point at the landmark it names.' }[kind],
        duration: 2500,
      })
    } else if (phase.kind === 'finished' && buzzed.current !== 'end') {
      buzzed.current = 'end'
      vibrate([150, 80, 150, 80, 300])
      const won = me.side === phase.winner
      const result = won ? toast.success : toast
      result(won ? `You won the ${game.name}!` : `${SIDES[phase.winner].label} won the ${game.name}`, {
        id: `result-${dropId}`,
        description: won && points !== undefined ? `+${points} points` : 'Get them next time.',
      })
    }
  }, [phase, me, dropId, points, game.name, kind])

  if (!state) {
    return (
      <section className="page stack game-lobby">
        <BackToMap />
        <p className="muted">{error ?? 'Loading the game…'}</p>
      </section>
    )
  }

  const title = drop?.title ?? game.name
  const side = me?.side ? SIDES[me.side] : null

  if (phase.kind === 'finished') {
    const won = me?.side === phase.winner
    return (
      <section className="game-screen game-result" style={sideStyle(phase.winner)}>
        <p className="game-eyebrow">
          {title} · {SIDES[phase.winner].label} wins
        </p>
        <WinnerHeadline state={state} winner={phase.winner} points={drop?.points} className="game-winners" />
        {me && <p className="game-big">{won ? 'You won! 🎉' : 'So close. Get them next time.'}</p>}
        <MvpLine state={state} meId={player.id} />
        {kind === 'quick_draw' ? (
          <DrawSides state={state} highlight={phase.winner} meId={player.id} />
        ) : kind === 'landmark' ? (
          <LandmarkSides state={state} serverNow={serverNow} highlight={phase.winner} meId={player.id} />
        ) : (
          <TugBar players={state.players} live={NO_LIVE} meId={player.id} />
        )}
        <Link className="button" to="/">
          Back to map
        </Link>
      </section>
    )
  }

  if (phase.kind === 'playing' || phase.kind === 'tallying') {
    if (!me?.side) return <Spectating title={title} name={game.name} phase={phase} state={state} live={live} serverNow={serverNow} drop={drop} />
    if (kind === 'landmark') {
      return <LandmarkPlay dropId={dropId} drop={drop} state={state} me={{ ...me, side: me.side }} offset={offset} serverNow={serverNow} compass={compass} />
    }
    if (kind === 'quick_draw') return <QuickDrawPlay dropId={dropId} state={state} me={{ ...me, side: me.side }} offset={offset} serverNow={serverNow} />
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
      <p className="game-eyebrow game-kind">
        <GameIcon kind={kind} />
        {game.name} · {drop?.points ?? '…'} pts to every winner
      </p>
      <h1>{title}</h1>
      <p className="muted">{game.blurb}</p>
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
      {kind === 'landmark' ? (
        <CompassGate compass={compass} joined={!!me}>
          <JoinButton dropId={dropId} drop={drop} code={key} label={`Join ${game.name}`} onJoined={refresh} />
        </CompassGate>
      ) : me ? (
        <MotionGate motion={shakes} kind={kind} />
      ) : (
        <JoinButton dropId={dropId} drop={drop} code={key} label={`Join the ${game.name}`} onJoined={refresh} />
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
      {isAdmin && (
        <Link className="button plain" to={`/battle/${dropId}`}>
          Open the big-screen view
        </Link>
      )}
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

function JoinButton({ dropId, drop, code, label, onJoined }: { dropId: string; drop: DropRow | null; code: string | null; label: string; onJoined: () => void }) {
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
        {busy ? 'Joining…' : label}
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

const READY: Record<MinigameKind, string> = {
  shake_off: 'Hold your phone tight. When it starts, shake it as fast as you can.',
  quick_draw: 'When it starts, hold your phone still. Flick it the instant it flashes DRAW!',
  landmark: 'When it starts, hold your phone flat and point its top edge at the landmark it names.',
}

/** The Shake-Off and Quick Draw both read motion; the permission state comes from game/motion.ts. */
function MotionGate({ motion, kind }: { motion: Pick<ReturnType<typeof useShakes>, 'permission' | 'requestPermission'>; kind: MinigameKind }) {
  if (motion.permission === 'needs-tap') {
    return (
      <button className="button primary" onClick={motion.requestPermission}>
        Tap to enable motion
      </button>
    )
  }
  if (motion.permission === 'denied') {
    return <p className="card muted">Motion access was denied, so you’ll tap instead. To shake, allow motion in Settings › Safari and reload.</p>
  }
  if (motion.permission === 'unsupported') return <p className="card"><strong>You’re in!</strong> <span className="muted">No motion sensor found, so you’ll tap instead.</span></p>
  return <p className="card"><strong>You’re in!</strong> <span className="muted">{READY[kind]}</span></p>
}

/**
 * Point to the Landmark needs a compass. Phones without one (or that refused access) can watch instead of join.
 * After joining: a figure-8 calibration step, since a compass that hasn't been waved around can be far off.
 */
function CompassGate({ compass, joined, children }: { compass: { status: CompassStatus; requestPermission: () => void }; joined: boolean; children: ReactNode }) {
  const [calibrated, setCalibrated] = useState(false)
  if (compass.status === 'needs-tap') {
    return (
      <button className="button primary" onClick={compass.requestPermission}>
        Tap to enable the compass
      </button>
    )
  }
  if (compass.status === 'denied' || compass.status === 'unsupported') {
    return (
      <p className="card">
        <strong>No compass on this phone.</strong>{' '}
        <span className="muted">
          {compass.status === 'denied' ? 'Compass access was denied, so you' : 'You'} can still watch: this screen follows the game and shows every
          reveal.
        </span>
      </p>
    )
  }
  if (compass.status === 'checking') return <p className="card muted">Checking for a compass…</p>
  if (!joined) return <>{children}</>
  if (!calibrated) {
    return (
      <div className="card calibrate">
        <svg className="figure-eight" viewBox="0 0 120 60" aria-hidden>
          <path d="M60 30 C 75 5, 110 5, 110 30 S 75 55, 60 30 S 10 5, 10 30 S 45 55, 60 30" />
          <circle r="5" className="figure-eight-dot" />
        </svg>
        <p>
          <strong>Calibrate your compass.</strong> <span className="muted">Wave your phone in a figure 8 a few times.</span>
        </p>
        <button className="button primary" onClick={() => setCalibrated(true)}>
          Done
        </button>
      </div>
    )
  }
  return <p className="card"><strong>You’re in!</strong> <span className="muted">{READY.landmark}</span></p>
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

type SpectatingProps = { title: string; name: string; phase: Phase; state: GameState; live: ReadonlyMap<string, number>; serverNow: number; drop: DropRow | null }

function Spectating({ title, name, phase, state, live, serverNow, drop }: SpectatingProps) {
  return (
    <section className="page stack game-lobby">
      <BackToMap />
      <p className="game-eyebrow">{title}</p>
      <h1>This {name} already started</h1>
      {phase.kind === 'playing' && (
        <p className="game-countdown" role="timer">
          <span>Time left</span>
          <strong>{seconds(phase.remainingMs)}</strong>
        </p>
      )}
      {state.kind === 'quick_draw' ? (
        <RoundBoard state={state} serverNow={serverNow} />
      ) : state.kind === 'landmark' ? (
        <LandmarkBoard state={state} serverNow={serverNow} drop={drop} />
      ) : (
        <TugBar players={state.players} live={live} />
      )}
      <Link className="button" to="/">
        Back to map
      </Link>
    </section>
  )
}

export default GamePage
