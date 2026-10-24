import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState, type CSSProperties } from 'react'
import { useParams } from 'react-router'
import TugBar from '../game/TugBar'
import { SIDES, sideTotals } from '../game/shakeoff'
import { useGame } from '../game/useGame'
import { useShakeBroadcast } from '../game/useShakeBroadcast'
import { claimUrl, getDrop, startGame } from '../lib/api'
import type { DropRow, GamePlayer, Side } from '../lib/database.types'
import { useClaimCodes } from '../lib/hooks'
import { useReadySession } from '../session/session'

const seconds = (ms: number) => Math.ceil(ms / 1000)

/** Projector view of one Shake-Off: /battle/:dropId. Listens only; it never joins or shakes. */
function BattlePage() {
  const { dropId = '' } = useParams()
  const { isAdmin } = useReadySession()
  const { state, phase, refresh } = useGame(dropId)
  const live = useShakeBroadcast(dropId, null)
  const [drop, setDrop] = useState<DropRow | null>(null)

  useEffect(() => {
    getDrop(dropId).then(setDrop, console.error)
  }, [dropId])

  if (!state) return <section className="battle center-screen">Loading…</section>
  const totals = sideTotals(state.players, phase.kind === 'finished' ? new Map() : live)
  const title = drop?.title ?? 'Shake-Off'

  if (phase.kind === 'finished') {
    const winner = SIDES[phase.winner]
    return (
      <section className="battle battle-result" style={{ '--side': winner.color, '--side-ink': winner.ink } as CSSProperties}>
        <p className="battle-eyebrow">{title}</p>
        <h1 className="battle-huge">{winner.label} wins!</h1>
        <TugBar totals={totals} big />
        <SideRosters players={state.players} highlight={phase.winner} />
      </section>
    )
  }

  if (phase.kind === 'playing' || phase.kind === 'tallying') {
    return (
      <section className="battle">
        <p className="battle-eyebrow">{title}</p>
        <h1 className="battle-huge">{phase.kind === 'playing' ? `${seconds(phase.remainingMs)}` : 'Counting…'}</h1>
        <TugBar totals={totals} big />
        <SideRosters players={state.players} live={live} />
      </section>
    )
  }

  const startsIn = phase.kind === 'lobby' ? phase.startsInMs : null
  return (
    <section className="battle">
      <p className="battle-eyebrow">Shake-Off · {drop?.points ?? '…'} pts to every winner</p>
      <h1 className="battle-title">{title}</h1>
      <p className="battle-huge">{startsIn !== null ? `Starting in ${seconds(startsIn)}` : `${state.players.length} joined`}</p>
      {startsIn === null && (
        <p className="battle-sub">Starts automatically at {state.settings.auto_start_players} players. Walk to the drop on the map, or scan to join.</p>
      )}
      <div className="battle-lobby">
        {isAdmin && <JoinQr dropId={dropId} />}
        <ul className="battle-roster">
          {state.players.map((p) => (
            <li key={p.player_id} style={{ '--player': p.color } as CSSProperties}>
              <span className="color-dot" aria-hidden />
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

function SideRosters({ players, live, highlight }: { players: GamePlayer[]; live?: ReadonlyMap<string, number>; highlight?: Side }) {
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
            {players
              .filter((p) => p.side === side)
              .map((p) => (
                <li key={p.player_id}>
                  {p.display_name} <strong>{Math.max(p.shakes, live?.get(p.player_id) ?? 0)}</strong>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export default BattlePage
