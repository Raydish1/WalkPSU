import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import Avatar from '../components/Avatar'
import { ChevronIcon } from '../components/icons'
import { joinGame, startGame, submitGhost } from '../lib/api'
import type { DropRow, GameState } from '../lib/database.types'
import { distanceM } from '../lib/geo'
import { useClaimRadius } from '../lib/hooks'
import { usePresence } from '../session/presence'
import GameIcon from './GameIcon'
import NeedleField from './NeedleField'
import { MINIGAMES } from './kinds'
import type { Phase } from './shakeoff'
import { useNeedleBroadcast, type NeedleSample } from './useNeedleBroadcast'
import { useSteer } from './useSteer'

const seconds = (ms: number) => Math.ceil(ms / 1000)

type Player = { id: string; display_name: string }

type Props = {
  dropId: string
  code: string | null
  drop: DropRow | null
  player: Player
  isAdmin: boolean
  state: GameState
  phase: Phase
  error: string | null
  refresh: () => void
  offset: number
}

/** Needle Rain on /game/:dropId. One storm, one winner, no sides. A solo practice run pays nothing. */
function NeedleRainGame({ dropId, code, drop, player, isAdmin, state, phase, error, refresh, offset }: Props) {
  const steer = useSteer()
  const me = state.players.find((p) => p.player_id === player.id) ?? null
  const [practice, setPractice] = useState<{ origin: number } | null>(null)
  const sampleRef = useRef<NeedleSample>({ x: 0.5, count: 0, eliminated: false })
  const offsetRef = useRef(0)
  const openLobby = phase.kind === 'lobby' && phase.startsInMs === null
  const livePractice = practice && openLobby ? practice : null
  useEffect(() => {
    offsetRef.current = livePractice ? 0 : offset
  })
  const playing = phase.kind === 'playing' && !!me && !livePractice
  const maxRate = state.settings.max_dodges_per_second

  useNeedleBroadcast(
    dropId,
    me && !livePractice ? { playerId: player.id, active: playing || phase.kind === 'tallying', report: playing } : null,
    sampleRef,
  )

  useEffect(() => {
    if (!livePractice || maxRate === undefined) return
    const origin = livePractice.origin
    const limit = state.settings.game_seconds
    const timer = window.setInterval(() => {
      const sample = sampleRef.current
      const elapsed = (Date.now() - origin) / 1000
      if (!sample.eliminated && elapsed < limit) return
      window.clearInterval(timer)
      submitGhost(dropId, sample.count).finally(() => {
        setPractice(null)
        refresh()
      })
    }, 200)
    return () => window.clearInterval(timer)
  }, [livePractice, maxRate, state.settings.game_seconds, dropId, refresh])

  const buzzed = useRef<string | null>(null)
  const points = drop?.points
  const winner = state.players.find((p) => p.player_id === state.game?.winner_id) ?? null
  useEffect(() => {
    if (!me) return
    if (phase.kind === 'playing' && !livePractice && buzzed.current !== 'start') {
      buzzed.current = 'start'
      navigator.vibrate?.(400)
      toast('Needle Rain started', { id: `start-${dropId}`, description: 'Tilt to dodge.', duration: 2500 })
    } else if (phase.kind === 'finished' && buzzed.current !== 'end') {
      buzzed.current = 'end'
      navigator.vibrate?.([150, 80, 150, 80, 300])
      const won = winner?.player_id === player.id
      const result = won ? toast.success : toast
      result(won ? 'You won the Needle Rain!' : `${winner?.display_name ?? 'Someone'} won the Needle Rain`, {
        id: `result-${dropId}`,
        description: won && points !== undefined ? `+${points} points` : 'Get them next time.',
      })
    }
  }, [phase, me, livePractice, dropId, points, winner, player.id])

  const title = drop?.title ?? 'Needle Rain'
  const seed = livePractice ? state.game?.ghost_seed : state.game?.round_seed
  const originMs = livePractice ? livePractice.origin : state.game?.started_at ? Date.parse(state.game.started_at) : 0
  const showField = !!seed && maxRate !== undefined && (livePractice !== null || playing)

  if (phase.kind === 'finished') {
    const won = winner?.player_id === player.id
    return (
      <section className="needle-screen needle-result">
        <p className="game-eyebrow">{title}</p>
        <h1>{won ? 'You won!' : `${winner?.display_name ?? 'Someone'} won`}</h1>
        {won && points !== undefined && <p className="needle-pay">+{points} points</p>}
        <ul className="needle-scores">
          {state.players.map((p) => (
            <li key={p.player_id}>
              <Avatar name={p.display_name} color={p.color} />
              <span>
                {p.display_name}
                {p.player_id === player.id && <span className="muted"> (you)</span>}
              </span>
              <strong>
                {p.dodges}
                {p.eliminated ? ' · out' : ''}
              </strong>
            </li>
          ))}
        </ul>
        <Link className="button" to="/">
          Back to map
        </Link>
      </section>
    )
  }

  if (showField && seed && maxRate !== undefined) {
    return (
      <section className="needle-screen">
        <NeedleField
          seed={seed}
          gameSeconds={state.settings.game_seconds}
          maxRate={maxRate}
          originMs={originMs}
          offsetRef={offsetRef}
          steer={steer}
          self={me ? { name: player.display_name, color: me.color } : { name: player.display_name, color: '#4363d8' }}
          onSample={(sample) => {
            sampleRef.current = sample
          }}
        />
        {!steer.motionReady && <Joystick stickRef={steer.stickRef} />}
        {livePractice && <p className="needle-note">Practice. No points.</p>}
      </section>
    )
  }

  if ((phase.kind === 'playing' || phase.kind === 'tallying') && !me) {
    return (
      <section className="page stack game-lobby">
        <Back />
        <h1>This Needle Rain already started</h1>
        <Link className="button" to="/">
          Back to map
        </Link>
      </section>
    )
  }

  const startsIn = phase.kind === 'lobby' ? phase.startsInMs : null
  const record = state.game?.ghost_dodges != null && state.game.ghost_name ? `${state.game.ghost_name} · ${state.game.ghost_dodges}` : null
  return (
    <section className="page stack game-lobby">
      <Back />
      <p className="game-eyebrow game-kind">
        <GameIcon kind="needle_rain" />
        Needle Rain · {drop?.points ?? '…'} pts to the winner
      </p>
      <h1>{title}</h1>
      <p className="muted">{MINIGAMES.needle_rain.blurb}</p>
      {record && <p className="needle-record">Record to beat: {record}</p>}
      {startsIn !== null ? (
        <p className="game-countdown" role="timer">
          <span>Starting in</span>
          <strong>{seconds(startsIn)}</strong>
        </p>
      ) : (
        <p className="muted">Starts automatically at {state.settings.auto_start_players} players, or when an admin taps Start.</p>
      )}
      {me ? <MotionLine steer={steer} /> : <Join dropId={dropId} drop={drop} code={code} onJoined={refresh} />}
      {me && openLobby && (
        <button className="button" onClick={() => setPractice({ origin: Date.now() })}>
          Practice run
        </button>
      )}
      <Roster players={state.players} meId={player.id} />
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

function Back() {
  return (
    <Link className="back-link" to="/">
      <ChevronIcon className="back-link-icon" />
      Map
    </Link>
  )
}

function Join({ dropId, drop, code, onJoined }: { dropId: string; drop: DropRow | null; code: string | null; onJoined: () => void }) {
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
        {busy ? 'Joining…' : 'Join the Needle Rain'}
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

function MotionLine({ steer }: { steer: ReturnType<typeof useSteer> }) {
  if (steer.permission === 'needs-tap') {
    return (
      <button className="button primary" onClick={steer.requestPermission}>
        Tap to enable motion
      </button>
    )
  }
  if (steer.permission === 'denied') return <p className="card muted">Motion was denied. Use the joystick, or the arrow keys.</p>
  if (steer.permission === 'unsupported') return <p className="card muted">No tilt sensor. Use the joystick, or the arrow keys.</p>
  return (
    <p className="card">
      <strong>You’re in!</strong> <span className="muted">Tilt your phone to slide. The storm is the same on every screen.</span>
    </p>
  )
}

function Roster({ players, meId }: { players: GameState['players']; meId: string }) {
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
      <button className="button" disabled={state.players.length < 2} onClick={() => startGame(dropId).then(onStarted, (e: Error) => setMessage(e.message))}>
        Admin: start now ({state.settings.admin_start_delay_seconds}s countdown)
      </button>
      {state.players.length < 2 && <span className="muted">Needs at least 2 players.</span>}
      {message && <span className="error">{message}</span>}
    </div>
  )
}

function Joystick({ stickRef }: { stickRef: { current: number } }) {
  const base = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLSpanElement>(null)
  function place(clientX: number) {
    const rect = base.current?.getBoundingClientRect()
    if (!rect) return
    const axis = Math.max(-1, Math.min(1, (clientX - (rect.left + rect.width / 2)) / (rect.width / 2)))
    stickRef.current = axis
    if (knob.current) knob.current.style.transform = `translate(calc(-50% + ${axis * 40}px), -50%)`
  }
  return (
    <div
      className="needle-stick"
      ref={base}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        place(e.clientX)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) place(e.clientX)
      }}
      onPointerUp={() => {
        stickRef.current = 0
        if (knob.current) knob.current.style.transform = 'translate(-50%, -50%)'
      }}
      onPointerCancel={() => {
        stickRef.current = 0
        if (knob.current) knob.current.style.transform = 'translate(-50%, -50%)'
      }}
    >
      <span className="needle-knob" ref={knob} />
    </div>
  )
}

export default NeedleRainGame
