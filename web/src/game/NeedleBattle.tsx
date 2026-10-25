import { useEffect, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import Avatar from '../components/Avatar'
import { claimUrl, startGame } from '../lib/api'
import type { DropRow, GameState } from '../lib/database.types'
import { useClaimCodes } from '../lib/hooks'
import { useReadySession } from '../session/session'
import GameIcon from './GameIcon'
import NeedleField, { type NeedleActor } from './NeedleField'
import type { Phase } from './shakeoff'
import { useNeedleBroadcast } from './useNeedleBroadcast'

const seconds = (ms: number) => Math.ceil(ms / 1000)
const IDLE = { current: { x: 0.5, count: 0, eliminated: false } }

/** Projector view of the same storm. Names and avatar colors have to read from across a table. */
function NeedleBattle({ dropId, drop, state, phase, refresh }: { dropId: string; drop: DropRow | null; state: GameState; phase: Phase; refresh: () => void }) {
  const { isAdmin } = useReadySession()
  const live = useNeedleBroadcast(dropId, null, IDLE)
  const actorsRef = useRef<NeedleActor[]>([])
  useEffect(() => {
    actorsRef.current = state.players.map((p) => {
      const seen = live.get(p.player_id)
      return {
        id: p.player_id,
        name: p.display_name,
        color: p.color,
        x: seen?.x ?? 0.5,
        dodges: Math.max(p.dodges, seen?.count ?? 0),
        eliminated: p.eliminated || !!seen?.eliminated,
      }
    })
  })
  const title = drop?.title ?? 'Needle Rain'
  const maxRate = state.settings.max_dodges_per_second
  const seed = state.game?.round_seed
  const originMs = state.game?.started_at ? Date.parse(state.game.started_at) : 0
  const offsetRef = useRef(0)

  if (phase.kind === 'finished') {
    const winner = state.players.find((p) => p.player_id === state.game?.winner_id)
    return (
      <section className="needle-screen needle-result is-big">
        <p className="battle-eyebrow">{title}</p>
        <h1>{winner ? `${winner.display_name} wins` : 'Round over'}</h1>
        {drop?.points !== undefined && <p className="needle-pay">+{drop.points} points</p>}
        <ul className="needle-scores">
          {state.players.map((p) => (
            <li key={p.player_id}>
              <Avatar name={p.display_name} color={p.color} large />
              <span>{p.display_name}</span>
              <strong>{p.dodges}</strong>
            </li>
          ))}
        </ul>
      </section>
    )
  }

  if ((phase.kind === 'playing' || phase.kind === 'tallying') && seed && maxRate !== undefined) {
    return (
      <section className="needle-screen is-big">
        <p className="battle-eyebrow">{title}</p>
        <NeedleField seed={seed} gameSeconds={state.settings.game_seconds} maxRate={maxRate} originMs={originMs} offsetRef={offsetRef} actorsRef={actorsRef} big />
      </section>
    )
  }

  const startsIn = phase.kind === 'lobby' ? phase.startsInMs : null
  return (
    <section className="battle">
      <p className="battle-eyebrow game-kind">
        <GameIcon kind="needle_rain" size={28} />
        Needle Rain · {drop?.points ?? '…'} pts to the winner
      </p>
      <h1 className="battle-title">{title}</h1>
      <p className="battle-huge">{startsIn !== null ? `Starting in ${seconds(startsIn)}` : `${state.players.length} joined`}</p>
      {state.game?.ghost_name && state.game.ghost_dodges != null && (
        <p className="battle-sub">
          Record to beat: {state.game.ghost_name} · {state.game.ghost_dodges}
        </p>
      )}
      <div className="battle-lobby">
        {isAdmin && <JoinQr dropId={dropId} />}
        <ul className="battle-roster">
          {state.players.map((p) => (
            <li key={p.player_id}>
              <Avatar name={p.display_name} color={p.color} large />
              {p.display_name}
            </li>
          ))}
        </ul>
      </div>
      {isAdmin && state.players.length >= 2 && (startsIn === null || startsIn > state.settings.admin_start_delay_seconds * 1000) && (
        <button className="button primary battle-start" onClick={() => startGame(dropId).then(refresh, (e: Error) => alert(e.message))}>
          Start now
        </button>
      )}
    </section>
  )
}

function JoinQr({ dropId }: { dropId: string }) {
  const { data: codes } = useClaimCodes()
  const code = codes.get(dropId)
  if (!code) return null
  return (
    <div className="qr-code">
      <QRCodeSVG value={claimUrl(dropId, code)} size={260} marginSize={2} />
      <span>Scan to join</span>
    </div>
  )
}

export default NeedleBattle
