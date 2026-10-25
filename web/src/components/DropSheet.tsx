import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Drawer } from 'vaul'
import { useGame } from '../game/useGame'
import { claimDrop } from '../lib/api'
import { DROP_TYPES } from '../lib/campus'
import type { DropRow } from '../lib/database.types'
import { PinIcon } from './icons'

type Props = {
  drop: DropRow | null
  open: boolean
  distance: number | null
  radius: number | null
  position: GeolocationPosition | null
  onClose: () => void
  onClaimed: () => void
}

/** A drop's details in a bottom sheet the player can drag away. Non-modal, so the map stays live behind it. */
function DropSheet({ drop, open, onClose, ...card }: Props) {
  // Vaul 1.1.2 doesn't pass `modal` on to Radix, so Radix still blocks the page with `pointer-events: none` on
  // <body>. Vaul undoes that only when it opens the drawer itself; this sheet is opened by map taps, so undo it here.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => (document.body.style.pointerEvents = 'auto'))
    return () => cancelAnimationFrame(frame)
  }, [open])

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
          {drop && <DropCard drop={drop} {...card} />}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

type CardProps = Omit<Props, 'drop' | 'open' | 'onClose'> & { drop: DropRow }

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

  const range =
    distance === null
      ? 'Waiting for GPS…'
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
        <span className="points-badge">{drop.points} pts</span>
      </div>
      <Drawer.Title asChild>
        <h3>{drop.title}</h3>
      </Drawer.Title>
      {drop.hint_photo_url && <img className="hint-photo" src={drop.hint_photo_url} alt="Hint" />}
      {drop.type === 'minigame' && <p className="muted">Two random teams race to shake the hardest. Every winner gets the points.</p>}
      <span className="range" data-in={inRange || undefined}>
        <PinIcon size={16} />
        {range}
      </span>
      {drop.type === 'minigame' ? (
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

/** Who's waiting in a Shake-Off, so players can decide whether it's worth the walk. */
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
