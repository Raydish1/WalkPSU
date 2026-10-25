import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState, type CSSProperties } from 'react'
import { Link, useParams } from 'react-router'
import Avatar from '../components/Avatar'
import { ChevronIcon } from '../components/icons'
import GameIcon from '../game/GameIcon'
import { MINIGAMES } from '../game/kinds'
import { DrawSides, RoundBoard } from '../game/QuickDrawScreens'
import TugBar from '../game/TugBar'
import { MvpLine, WinnerHeadline } from '../game/Results'
import { SIDES, shakesOf, sidePlayers } from '../game/shakeoff'
import { useGame } from '../game/useGame'
import { useShakeBroadcast } from '../game/useShakeBroadcast'
import { claimUrl, getDrop, startGame } from '../lib/api'
import type { DropRow, GamePlayer, Side } from '../lib/database.types'
import { useClaimCodes } from '../lib/hooks'
import { useReadySession } from '../session/session'

const seconds = (ms: number) => Math.ceil(ms / 1000)
const NO_LIVE: ReadonlyMap<string, number> = new Map()

/** Projector view of one mini-game: /battle/:dropId. Listens only; it never joins or plays. */
function BattlePage() {
  const { dropId = '' } = useParams()
  return (
    <>
      {/* Full-screen with no tab bar, so whoever opened it (an organizer's phone or laptop) needs a way out. */}
      <Link className="battle-exit" to={`/game/${dropId}`}>
        <ChevronIcon className="back-link-icon" />
        Lobby
      </Link>
      <BattleScreen dropId={dropId} />
    </>
  )
}

function BattleScreen({ dropId }: { dropId: string }) {
  const { isAdmin } = useReadySession()
  const { state, phase, refresh, serverNow } = useGame(dropId)
  const live = useShakeBroadcast(dropId, null)
  const [drop, setDrop] = useState<DropRow | null>(null)

  useEffect(() => {
    getDrop(dropId).then(setDrop, console.error)
  }, [dropId])

  if (!state) {
    return (
      <section className="battle">
        <span className="spinner" aria-hidden />
        <p className="battle-sub">Loading…</p>
      </section>
    )
  }
  const shown = phase.kind === 'finished' ? NO_LIVE : live
  const kind = state.kind
  const game = MINIGAMES[kind]
  const title = drop?.title ?? game.name

  if (phase.kind === 'finished') {
    const winner = SIDES[phase.winner]
    return (
      <section className="battle battle-result" style={{ '--side': winner.color, '--side-ink': winner.ink } as CSSProperties}>
        <p className="battle-eyebrow">
          {title} · {winner.label} wins
        </p>
        <WinnerHeadline state={state} winner={phase.winner} points={drop?.points} className="battle-winners" />
        <MvpLine state={state} />
        {kind === 'quick_draw' ? (
          <DrawSides state={state} highlight={phase.winner} />
        ) : (
          <>
            <TugBar players={state.players} live={shown} big />
            <SideRosters players={state.players} live={shown} highlight={phase.winner} />
          </>
        )}
      </section>
    )
  }

  if ((phase.kind === 'playing' || phase.kind === 'tallying') && kind === 'quick_draw') {
    return (
      <section className="battle">
        <p className="battle-eyebrow">{title}</p>
        <RoundBoard state={state} serverNow={serverNow} big />
        <DrawSides state={state} />
      </section>
    )
  }

  if (phase.kind === 'playing' || phase.kind === 'tallying') {
    return (
      <section className="battle">
        <p className="battle-eyebrow">{title}</p>
        <h1 className="battle-huge">{phase.kind === 'playing' ? `${seconds(phase.remainingMs)}` : 'Counting…'}</h1>
        <TugBar players={state.players} live={shown} big />
        <SideRosters players={state.players} live={shown} />
      </section>
    )
  }

  const startsIn = phase.kind === 'lobby' ? phase.startsInMs : null
  return (
    <section className="battle">
      <p className="battle-eyebrow game-kind">
        <GameIcon kind={kind} size={28} />
        {game.name} · {drop?.points ?? '…'} pts to every winner
      </p>
      <h1 className="battle-title">{title}</h1>
      <p className="battle-huge">{startsIn !== null ? `Starting in ${seconds(startsIn)}` : `${state.players.length} joined`}</p>
      {startsIn === null && (
        <p className="battle-sub">Starts automatically at {state.settings.auto_start_players} players. Walk to the drop on the map, or scan to join.</p>
      )}
      <div className="battle-lobby">
        {isAdmin && <JoinQr dropId={dropId} />}
        <ul className="battle-roster">
          {state.players.map((p) => (
            <li key={p.player_id}>
              <Avatar name={p.display_name} color={p.color} />
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

function SideRosters({ players, live, highlight }: { players: GamePlayer[]; live: ReadonlyMap<string, number>; highlight?: Side }) {
  return (
    <div className="battle-sides">
      {(['blue', 'white'] as const).map((side) => (
        <div
          key={side}
          className={`battle-side ${highlight === side ? 'battle-side-won' : ''}`}
          style={{ '--side': SIDES[side].color, '--side-ink': SIDES[side].ink } as CSSProperties}
        >
          <h2>{SIDES[side].label}</h2>
          <ul>
            {sidePlayers(players, side, live).map((p) => (
              <li key={p.player_id}>
                <span>{p.display_name}</span> <strong>{shakesOf(p, live)}</strong>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export default BattlePage
