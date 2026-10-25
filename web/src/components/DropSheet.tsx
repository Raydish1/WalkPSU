import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Drawer } from 'vaul'
import GameIcon from '../game/GameIcon'
import { minigameOf } from '../game/kinds'
import { useGame } from '../game/useGame'
import { claimDrop, closeDrop } from '../lib/api'
import { DROP_TYPES } from '../lib/campus'
import type { DropRow } from '../lib/database.types'
import { distanceM } from '../lib/geo'
import { useLeaderboard } from '../lib/hooks'
import { usePresence } from '../session/presence'
import { useReadySession } from '../session/session'
import { eventTime } from '../lib/eventTime'
import { ClockIcon, PinIcon } from './icons'
import PhotoHuntCard from './PhotoHuntCard'
import { useNonModalSheet } from './useNonModalSheet'

type Props = {
  drop: DropRow | null
  open: boolean
  distance: number | null
  radius: number | null
  position: GeolocationPosition | null
  onClose: () => void
  onClaimed: () => void
  /** The drop was cleared from the map (an admin, or the player who started a meetup). */
  onCleared: () => void
  /** A photo hunt photo was accepted; `points` is what the server awarded. */
  onFound: (points: number, reason: string) => void
}

/** A drop's details in a bottom sheet the player can drag away. Non-modal, so the map stays live behind it. */
function DropSheet({ drop, open, onClose, onCleared, ...card }: Props) {
  useNonModalSheet(open)

  return (
    <Drawer.Root open={open && drop !== null} onOpenChange={(next) => !next && onClose()} modal={false}>
      <Drawer.Portal>
        <Drawer.Content
          className="drop-sheet map-card"
          aria-describedby={undefined}
          // Map taps decide for themselves: another marker swaps the sheet, empty map closes it.
          onInteractOutside={(e) => e.preventDefault()}
        >
          <Drawer.Handle className="drop-sheet-handle" />
          {drop &&
            (drop.type === 'photo_hunt' ? (
              <PhotoHuntCard drop={drop} position={card.position} onFound={card.onFound} />
            ) : (
              <DropCard drop={drop} {...card} />
            ))}
          {drop && <ClearDrop key={drop.id} drop={drop} onCleared={onCleared} />}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

type CardProps = Omit<Props, 'drop' | 'open' | 'onClose' | 'onCleared'> & { drop: DropRow }

function DropCard({ drop, distance, radius, position, onClaimed }: CardProps) {
  const [busy, setBusy] = useState(false)
  const inRange = radius !== null && distance !== null && distance <= radius
  const verb = drop.type === 'minigame' ? 'join' : 'claim'

  async function claim() {
    if (!position) return
    setBusy(true)
    try {
      await claimDrop(drop.id, { lat: position.coords.latitude, lng: position.coords.longitude })
      navigator.vibrate?.(30)
      toast.success(`Claimed! +${drop.points} points`, { description: drop.title })
      onClaimed()
    } catch (e) {
      toast.error('Couldn’t claim', { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const meetup = drop.type === 'meetup'
  const range =
    distance === null
      ? 'Waiting for GPS…'
      : meetup
        ? inRange
          ? 'You’re here!'
          : `${Math.round(distance)} m away`
        : inRange
          ? `You’re in range to ${verb}!`
          : `${Math.round(distance)} m away · get within ${radius ?? '…'} m`

  return (
    <div className="drop-card">
      <div className="drop-card-head">
        <span className="chip" style={{ '--player': DROP_TYPES[drop.type].color } as CSSProperties}>
          <span className="color-dot" aria-hidden />
          {DROP_TYPES[drop.type].label}
        </span>
        {!meetup && <span className="points-badge">{drop.points} pts</span>}
      </div>
      <div className="drop-card-title">
        <Drawer.Title asChild>
          <h3>{drop.title}</h3>
        </Drawer.Title>
        {drop.subtitle && <p className="drop-subtitle">{drop.subtitle}</p>}
      </div>
      {drop.starts_at && drop.expires_at && (
        <span className="event-time">
          <ClockIcon size={16} />
          {eventTime(drop.starts_at, drop.expires_at)}
        </span>
      )}
      {drop.hint_photo_url && <img className="hint-photo" src={drop.hint_photo_url} alt="Hint" />}
      {drop.type === 'minigame' && <GameLine drop={drop} radius={radius} />}
      <span className="range" data-in={inRange || undefined}>
        <PinIcon size={16} />
        {range}
      </span>
      {meetup ? (
        <span className="muted footnote">A player started this. No points, just people: go say hi.</span>
      ) : drop.type === 'minigame' ? (
        <>
          <LobbyStatus dropId={drop.id} />
          <Link className="button primary" to={`/game/${drop.id}`}>
            Open the lobby
          </Link>
        </>
      ) : (
        <>
          <button className="button primary" onClick={claim} disabled={busy || !inRange}>
            {busy ? 'Claiming…' : 'Claim'}
          </button>
          <span className="muted footnote">Indoors? Scan the drop’s QR code to claim from anywhere.</span>
        </>
      )}
    </div>
  )
}

/**
 * Takes a drop off the map: admins for any drop, players for a meetup they started. It can't be undone, so the
 * first tap arms it and a second tap within a few seconds confirms.
 */
function ClearDrop({ drop, onCleared }: { drop: DropRow; onCleared: () => void }) {
  const { player, isAdmin } = useReadySession()
  const mine = drop.type === 'meetup' && drop.created_by === player.id
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const disarm = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => clearTimeout(disarm.current ?? undefined), [])
  if (!isAdmin && !mine) return null

  async function clear() {
    if (!armed) {
      setArmed(true)
      disarm.current = setTimeout(() => setArmed(false), 3000)
      return
    }
    setBusy(true)
    try {
      await closeDrop(drop.id)
      toast(mine ? 'Meetup ended' : 'Drop cleared', { description: drop.title })
      onCleared()
    } catch (e) {
      toast.error('Couldn’t clear it', { description: (e as Error).message })
      setBusy(false)
      setArmed(false)
    }
  }

  const label = mine ? 'End meetup' : 'Clear from map'
  return (
    <button className="button danger clear-drop" onClick={clear} disabled={busy} data-armed={armed || undefined}>
      {busy ? 'Clearing…' : armed ? `Tap again to ${label.toLowerCase()}` : label}
    </button>
  )
}

/** Which mini-game this lobby plays, so players know what they're walking into. */
function GameLine({ drop, radius }: { drop: DropRow; radius: number | null }) {
  const game = minigameOf(drop.game)
  const needle = drop.game === 'needle_rain'
  return (
    <div className="game-line">
      <p className="game-kind">
        <GameIcon kind={drop.game ?? 'shake_off'} />
        <strong>{game.name}</strong>
      </p>
      <p className="muted">
        {game.blurb}
        {needle ? '' : ' Every winner gets the points.'}
      </p>
      {needle && drop.status === 'active' && <NeedleRival drop={drop} radius={radius} />}
    </div>
  )
}

/** Someone ahead on points, inside this drop's claim radius, with map sharing on. Presence only: nothing is stored. */
function NeedleRival({ drop, radius }: { drop: DropRow; radius: number | null }) {
  const { player } = useReadySession()
  const { others } = usePresence()
  const { data: scores } = useLeaderboard()
  if (radius === null) return null
  const mine = scores.find((row) => row.player_id === player.id)
  if (!mine) return null
  const here = others
    .flatMap((other) => {
      const score = scores.find((row) => row.player_id === other.playerId)
      if (!score || score.points <= mine.points) return []
      const dist = distanceM(other.lat, other.lng, drop.lat, drop.lng)
      if (dist > radius) return []
      return [{ name: other.name, gap: score.points - mine.points, dist }]
    })
    .sort((a, b) => a.gap - b.gap || a.dist - b.dist)[0]
  if (!here) return null
  return (
    <p className="needle-rival">
      {here.name} is here. You’re {here.gap} pts behind.
    </p>
  )
}

/** Who's waiting in a mini-game lobby, so players can decide whether it's worth the walk. */
function LobbyStatus({ dropId }: { dropId: string }) {
  const { state, phase } = useGame(dropId)
  if (!state) return null
  const joined = state.players.length
  const text =
    phase.kind === 'playing' || phase.kind === 'tallying'
      ? 'A round is being played right now'
      : phase.kind === 'finished'
        ? 'This round is over'
        : phase.kind === 'lobby' && phase.startsInMs !== null
          ? `Starting in ${Math.ceil(phase.startsInMs / 1000)}s · ${joined} joined`
          : `${joined} of ${state.settings.auto_start_players} joined · starts automatically`
  return <span className="lobby-status">{text}</span>
}

export default DropSheet
