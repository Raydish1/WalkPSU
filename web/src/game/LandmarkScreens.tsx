import { useMemo, type CSSProperties, type RefObject } from 'react'
import type { Position } from 'geojson'
import type { Building } from '../lib/buildings'
import type { GamePlayer, GameRound, GameState, LandmarkSettings, Side } from '../lib/database.types'
import { distanceM } from '../lib/geo'
import { useBuildings } from '../lib/hooks'
import { angleDiff, type CompassStatus } from './compass'
import { averageError, formatDeg, roundPhase, roundPoints, roundsPointed, sideByAccuracy, sideErrors } from './landmark'
import { currentRound } from './quickdraw'
import { SIDES } from './shakeoff'
import { useLandmarkAim } from './useLandmarkAim'

const sideStyle = (side: Side) => ({ '--side': SIDES[side].color, '--side-ink': SIDES[side].ink }) as CSSProperties
const seconds = (ms: number) => Math.ceil(ms / 1000)

type Spot = { lat: number; lng: number }

type PlayProps = {
  dropId: string
  drop: Spot | null
  state: GameState
  me: GamePlayer & { side: Side }
  offset: number
  serverNow: number
  compass: { status: CompassStatus; heading: number | null; headingRef: RefObject<number | null> }
}

/** A player's round: the landmark's name and a countdown, a dial that fills while they hold steady, then the reveal. */
export function LandmarkPlay({ dropId, drop, state, me, offset, serverNow, compass }: PlayProps) {
  const settings = state.settings as GameState['settings'] & LandmarkSettings
  const round = currentRound(state.rounds, serverNow)
  const { aims, steady, error } = useLandmarkAim({ dropId, round, settings, offset, headingRef: compass.headingRef, active: true })
  const phase = round ? roundPhase(state, round, serverNow) : null
  const aim = round ? aims[round.round] : undefined
  const result = round ? state.results.find((r) => r.round === round.round && r.player_id === me.player_id) : undefined
  const off = result?.value ?? (aim && round?.bearing !== undefined ? angleDiff(aim.heading, round.bearing) : null)

  return (
    <section className="game-screen aim-screen" data-stage={phase?.kind ?? 'waiting'} style={sideStyle(me.side)}>
      <div className="game-top">
        <span className="side-chip">You’re {SIDES[me.side].label}</span>
        <span className="draw-round">{round ? `Round ${round.round} of ${state.rounds.length}` : 'Get ready'}</span>
      </div>
      {round && phase?.kind === 'pointing' ? (
        <div className="game-hero">
          <p className="aim-prompt">Point at</p>
          <h1 className="aim-target">{round.landmark?.name}</h1>
          <Dial heading={compass.heading} steady={aim ? 1 : steady} locked={!!aim} />
          <p className="aim-status" role="status">
            {aim
              ? 'Locked in. Wait for the reveal.'
              : compass.heading === null
                ? 'No compass reading. Hold your phone flat.'
                : 'Hold your phone flat, top edge toward it, and keep it steady.'}
          </p>
          <p className="game-timer">{seconds(phase.remainingMs)}s</p>
        </div>
      ) : round ? (
        <div className="game-hero">
          <p className="aim-prompt">{round.landmark?.name}</p>
          {off !== null ? (
            <>
              <p className="game-count">{formatDeg(off)}</p>
              <span className="game-count-label">off</span>
            </>
          ) : (
            <h1 className="game-huge">Missed</h1>
          )}
          {drop && <LandmarkMap drop={drop} state={state} round={round} meId={me.player_id} />}
        </div>
      ) : (
        <div className="game-hero">
          <h1 className="game-huge">Get ready</h1>
          <p className="aim-status">Hold your phone flat. You’ll get 8 seconds per landmark.</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

/** The phone's current heading as a needle, with a ring that fills while it's held steady. North is up. */
function Dial({ heading, steady, locked }: { heading: number | null; steady: number; locked: boolean }) {
  const r = 44
  const circumference = 2 * Math.PI * r
  return (
    <svg className="aim-dial" viewBox="0 0 100 100" role="img" aria-label={heading === null ? 'No compass reading' : `Heading ${Math.round(heading)} degrees`}>
      <circle cx="50" cy="50" r={r} className="aim-dial-track" />
      <circle
        cx="50"
        cy="50"
        r={r}
        className="aim-dial-steady"
        data-locked={locked || undefined}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - steady)}
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="16" className="aim-dial-north">
        N
      </text>
      {heading !== null && (
        <g transform={`rotate(${heading} 50 50)`}>
          <path d="M50 24 L56 54 L50 50 L44 54 Z" className="aim-dial-needle" />
        </g>
      )}
    </svg>
  )
}

/** Projector, while players point: the landmark, a countdown, and who has locked in (no answers until the reveal). */
export function LandmarkBoard({ state, serverNow, drop }: { state: GameState; serverNow: number; drop: Spot | null }) {
  const round = currentRound(state.rounds, serverNow) ?? state.rounds[0]
  if (!round) return null
  const phase = roundPhase(state, round, serverNow)
  if (phase.kind === 'reveal') {
    return (
      <div className="landmark-reveal">
        <p className="round-board-head">
          <strong>
            Round {round.round} of {state.rounds.length}
          </strong>{' '}
          · {round.landmark?.name} is at {formatDeg(round.bearing ?? 0)}
        </p>
        {drop && <LandmarkMap drop={drop} state={state} round={round} big />}
        <ol className="round-ranking">
          {roundPoints(state, round.round).map(({ player, result }) => (
            <li key={player.player_id} style={sideStyle(player.side!)}>
              <span className="color-dot" style={{ background: player.color }} aria-hidden />
              <span className="round-name">{player.display_name}</span>
              <span className="side-tag">{SIDES[player.side!].label}</span>
              <strong className="round-time">{result?.value != null ? `${formatDeg(result.value)} off` : 'missed'}</strong>
            </li>
          ))}
        </ol>
      </div>
    )
  }
  const locked = new Set(state.results.filter((r) => r.round === round.round).map((r) => r.player_id))
  return (
    <div className="round-board round-board-big">
      <p className="round-board-head">
        <strong>
          Round {round.round} of {state.rounds.length}
        </strong>{' '}
        · {seconds(phase.remainingMs)}s
      </p>
      <p className="aim-prompt">Point at</p>
      <h2 className="aim-target">{round.landmark?.name}</h2>
      <ul className="aim-locked">
        {state.players
          .filter((p) => p.side)
          .map((p) => (
            <li key={p.player_id} data-locked={locked.has(p.player_id) || undefined}>
              <span className="color-dot" style={{ background: p.color }} aria-hidden />
              {p.display_name}
              <span className="muted">{locked.has(p.player_id) ? 'locked in' : 'aiming…'}</span>
            </li>
          ))}
      </ul>
    </div>
  )
}

/** Each side's average error and its players' averages. With `highlight` (the winner) it's the final score. */
export function LandmarkSides({ state, serverNow, highlight, meId }: { state: GameState; serverNow: number; highlight?: Side; meId?: string }) {
  const done = roundsPointed(state, serverNow)
  const errors = sideErrors(state, done)
  return (
    <div className="battle-sides draw-sides">
      {(['blue', 'white'] as const).map((side) => (
        <div key={side} className={`battle-side ${highlight === side ? 'battle-side-won' : ''}`} style={sideStyle(side)}>
          <h2>
            {SIDES[side].label} <span className="draw-avg">{errors[side] !== null ? `avg ${formatDeg(errors[side]!)} off` : ''}</span>
          </h2>
          <ul>
            {sideByAccuracy(state, side, done).map((p) => {
              const avg = averageError(state, p.player_id, done)
              return (
                <li key={p.player_id}>
                  <span>{p.player_id === meId ? `${p.display_name} (you)` : p.display_name}</span> <strong>{avg !== null ? formatDeg(avg) : '–'}</strong>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

// Local meters around the drop: plenty accurate across a campus, and north stays up.
const M_PER_DEG_LAT = 111_195
function projector(origin: Spot) {
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((origin.lat * Math.PI) / 180)
  return ([lng, lat]: Position) => [(lng - origin.lng) * mPerDegLng, -(lat - origin.lat) * M_PER_DEG_LAT] as const
}

type MapProps = { drop: Spot; state: GameState; round: GameRound; meId?: string; big?: boolean }

/**
 * The reveal: campus buildings around the drop (north up), the drop, the round's landmark, the true line to it, and
 * every player's arrow in their color, drawn as long as the true line so near misses are easy to compare.
 */
export function LandmarkMap({ drop, state, round, meId, big = false }: MapProps) {
  const buildings = useBuildings()
  const landmark = round.landmark
  const project = useMemo(() => projector(drop), [drop])
  const length = landmark ? distanceM(drop.lat, drop.lng, landmark.lat, landmark.lng) : 300
  const pad = length * 0.35 + 40
  const view = { x: -length - pad, y: -length - pad, size: 2 * (length + pad) }
  const footprints = useMemo(() => {
    const inView = ([x, y]: readonly [number, number]) => x > view.x && x < view.x + view.size && y > view.y && y < view.y + view.size
    return buildings
      .filter((b) => inView(project([b.properties.lng, b.properties.lat])))
      .map((b) => ({ num: b.properties.num, d: outline(b, project) }))
    // view depends only on `length`, which is in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildings, project, length])
  if (!landmark || round.bearing === undefined) return null

  const tip = (heading: number) => {
    const rad = (heading * Math.PI) / 180
    return [Math.sin(rad) * length, -Math.cos(rad) * length] as const
  }
  const [tx, ty] = tip(round.bearing)
  const arrows = roundPoints(state, round.round).filter((x) => x.result?.heading != null)
  const stroke = view.size / 160

  return (
    <svg
      className={`landmark-map ${big ? 'landmark-map-big' : ''}`}
      viewBox={`${view.x} ${view.y} ${view.size} ${view.size}`}
      role="img"
      aria-label={`Map: the true line from the drop to ${landmark.name}, and ${arrows.length} players' arrows`}
    >
      {footprints.map((f) => (
        <path key={f.num} d={f.d} className={f.num === landmark.num ? 'lm-building lm-target' : 'lm-building'} />
      ))}
      <line x1={0} y1={0} x2={tx} y2={ty} className="lm-true" strokeWidth={stroke * 2.2} />
      {arrows.map(({ player, result }) => {
        const [x, y] = tip(result!.heading!)
        const angle = result!.heading!
        return (
          <g key={player.player_id} className="lm-arrow" data-me={player.player_id === meId || undefined}>
            <line x1={0} y1={0} x2={x} y2={y} stroke={player.color} strokeWidth={stroke * (player.player_id === meId ? 1.8 : 1.2)} />
            <path d={`M0 0 L${-stroke * 4} ${stroke * 8} L${stroke * 4} ${stroke * 8} Z`} fill={player.color} transform={`translate(${x} ${y}) rotate(${angle})`} />
          </g>
        )
      })}
      <circle cx={tx} cy={ty} r={stroke * 4} className="lm-target-dot" />
      <text x={tx} y={ty - stroke * 7} className="lm-label" fontSize={stroke * 9}>
        {landmark.name}
      </text>
      <circle cx={0} cy={0} r={stroke * 4} className="lm-drop" />
      <text x={view.x + stroke * 6} y={view.y + stroke * 14} className="lm-north" fontSize={stroke * 10}>
        N ↑
      </text>
    </svg>
  )
}

function outline(b: Building, project: ReturnType<typeof projector>) {
  const polygons = b.geometry.type === 'Polygon' ? [b.geometry.coordinates] : b.geometry.coordinates
  return polygons
    .map(([outer]) => outer.map((p, i) => `${i ? 'L' : 'M'}${project(p).map((n) => n.toFixed(1)).join(' ')}`).join('') + 'Z')
    .join('')
}
