import type { CSSProperties } from 'react'
import type { GamePlayer, GameState, Side, TimedSettings } from '../lib/database.types'
import { bestTimes, currentRound, formatMs, roundRanking, sideAverages, sideByBestTime } from './quickdraw'
import { SIDES } from './shakeoff'
import { useQuickDraw, type DrawResult } from './useQuickDraw'

const sideStyle = (side: Side) => ({ '--side': SIDES[side].color, '--side-ink': SIDES[side].ink }) as CSSProperties

type PlayProps = { dropId: string; state: GameState; me: GamePlayer & { side: Side }; offset: number; serverNow: number }

/** A player's Quick Draw: a calm "Hold still…", then a full-screen flash, then their time. */
export function QuickDrawPlay({ dropId, state, me, offset, serverNow }: PlayProps) {
  const settings = state.settings as GameState['settings'] & TimedSettings
  const { stage, results, error, flick, motionReady } = useQuickDraw({ dropId, rounds: state.rounds, settings, offset, serverNow, active: true })
  const round = currentRound(state.rounds, serverNow)
  const best = Object.values(results).flatMap((r) => (r.kind === 'time' ? [r.ms] : []))
  const label = round ? `Round ${round.round} of ${state.rounds.length}` : 'Get ready'

  return (
    <section
      className="game-screen draw-screen"
      data-stage={stage.kind}
      style={sideStyle(me.side)}
      // Without a motion sensor the whole screen is the trigger; pointerdown fires sooner than click.
      onPointerDown={motionReady ? undefined : flick}
    >
      <div className="game-top">
        <span className="side-chip">You’re {SIDES[me.side].label}</span>
        <span className="draw-round">{label}</span>
      </div>
      <div className="game-hero" role="status" aria-live="assertive">
        {stage.kind === 'draw' ? (
          <h1 className="draw-signal">DRAW!</h1>
        ) : stage.kind === 'done' ? (
          <DrawOutcome result={stage.result} />
        ) : stage.kind === 'hold' ? (
          <>
            <h1 className="game-huge draw-hold">Hold still…</h1>
            <p className="muted">{motionReady ? 'Flick your phone the instant it says DRAW!' : 'Tap anywhere the instant it says DRAW!'}</p>
          </>
        ) : (
          <>
            <h1 className="game-huge">Get ready</h1>
            <p className="muted">Hold your phone still. Moving before the signal is a false start.</p>
          </>
        )}
      </div>
      {stage.kind !== 'draw' && (
        <p className="draw-best">{best.length ? `Your best: ${formatMs(Math.min(...best))}` : 'Best valid time counts'}</p>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

function DrawOutcome({ result }: { result: DrawResult }) {
  if (result.kind === 'time') {
    return (
      <>
        <p className="game-count">{result.ms}</p>
        <span className="game-count-label">ms</span>
      </>
    )
  }
  return (
    <>
      <h1 className="game-huge">{result.kind === 'false-start' ? 'False start!' : 'Too slow'}</h1>
      <p className="muted">{result.kind === 'false-start' ? 'You moved before the signal. This round doesn’t count.' : 'No flick in time. This round doesn’t count.'}</p>
    </>
  )
}

/** Live ranking for the round on now (or the last one): the projector's main view. */
export function RoundBoard({ state, serverNow, big = false }: { state: GameState; serverNow: number; big?: boolean }) {
  const round = currentRound(state.rounds, serverNow) ?? state.rounds[0]
  if (!round) return null
  const drawn = serverNow >= Date.parse(round.signal_at!)
  return (
    <div className={`round-board ${big ? 'round-board-big' : ''}`}>
      <p className="round-board-head">
        <strong>
          Round {round.round} of {state.rounds.length}
        </strong>{' '}
        · {drawn ? 'DRAW!' : 'Hold still…'}
      </p>
      <ol className="round-ranking">
        {roundRanking(state, round.round).map(({ player, result }) => (
          <li key={player.player_id} style={sideStyle(player.side!)}>
            <span className="color-dot" style={{ background: player.color }} aria-hidden />
            <span className="round-name">{player.display_name}</span>
            <span className="side-tag">{SIDES[player.side!].label}</span>
            <strong className="round-time">{result ? (result.value !== null ? formatMs(result.value) : 'False start') : drawn ? '…' : ''}</strong>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Each side's average best time with its players' best times. With `highlight` (the winner) it's the final score. */
export function DrawSides({ state, highlight, meId }: { state: GameState; highlight?: Side; meId?: string }) {
  const averages = sideAverages(state, highlight !== undefined)
  const best = bestTimes(state.results)
  return (
    <div className="battle-sides draw-sides">
      {(['blue', 'white'] as const).map((side) => (
        <div key={side} className={`battle-side ${highlight === side ? 'battle-side-won' : ''}`} style={sideStyle(side)}>
          <h2>
            {SIDES[side].label} <span className="draw-avg">{averages[side] !== null ? `avg ${formatMs(averages[side]!)}` : ''}</span>
          </h2>
          <ul>
            {sideByBestTime(state, side).map((p) => (
              <li key={p.player_id}>
                <span>{p.player_id === meId ? `${p.display_name} (you)` : p.display_name}</span>{' '}
                <strong>{best.get(p.player_id) != null ? formatMs(best.get(p.player_id)!) : highlight ? 'no time' : '–'}</strong>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
