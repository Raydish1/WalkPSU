import { useEffect, useState, type ChangeEvent, type CSSProperties } from 'react'
import { toast } from 'sonner'
import { Drawer } from 'vaul'
import { submitHuntPhoto } from '../lib/api'
import { DROP_TYPES } from '../lib/campus'
import type { DropRow } from '../lib/database.types'
import { toJpegBase64 } from '../lib/image'
import { PinIcon } from './icons'

/** Milliseconds until `until`, ticking every second. */
function useTimeLeft(until: string | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!until) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [until])
  return until ? Math.max(0, new Date(until).getTime() - now) : null
}

function formatTime(ms: number) {
  const seconds = Math.ceil(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

type Props = { drop: DropRow; position: GeolocationPosition | null; onFound: (points: number, reason: string) => void }

/** Map card for a photo hunt: the reference photo, the twist, and a camera button. Gemini judges the photo server-side. */
function PhotoHuntCard({ drop, position, onFound }: Props) {
  const [busy, setBusy] = useState(false)
  const [verdict, setVerdict] = useState<string | null>(null)
  const found = drop.first_found_at !== null
  const timeLeft = useTimeLeft(found ? drop.expires_at : null)
  const over = timeLeft === 0

  async function submit(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // so retaking a photo fires onChange again
    if (!file || !position) return
    setBusy(true)
    setVerdict(null)
    try {
      const image = await toJpegBase64(file)
      const result = await submitHuntPhoto(drop.id, image, { lat: position.coords.latitude, lng: position.coords.longitude })
      if (result.match) {
        navigator.vibrate?.([40, 60, 40])
        onFound(result.points, result.reason)
      } else {
        setVerdict(result.reason)
      }
    } catch (err) {
      toast.error('Couldn’t check your photo', { description: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const status = !found
    ? 'The spot is somewhere in this circle. Find it, then take the photo there.'
    : over
      ? 'This hunt is over.'
      : `Found! Closes in ${formatTime(timeLeft ?? 0)}. Each later finder gets half the points of the one before.`
  const disabled = busy || !position || over

  return (
    <div className="drop-card">
      <div className="drop-card-head">
        <span className="chip" style={{ '--player': DROP_TYPES.photo_hunt.color } as CSSProperties}>
          <span className="color-dot" aria-hidden />
          {DROP_TYPES.photo_hunt.label}
        </span>
        <span className="points-badge">{drop.points} pts</span>
      </div>
      <Drawer.Title asChild>
        <h3>{drop.title}</h3>
      </Drawer.Title>
      {drop.hint_photo_url && <img className="hint-photo" src={drop.hint_photo_url} alt="The spot to find" />}
      {drop.twist && (
        <p className="hunt-twist">
          <strong>Twist:</strong> {drop.twist}
        </p>
      )}
      <span className="range" data-in={(found && !over) || undefined}>
        <PinIcon size={16} />
        {status}
      </span>
      <label className="button primary" aria-disabled={disabled || undefined}>
        {busy ? 'Checking your photo…' : position ? 'Take the photo' : 'Waiting for GPS…'}
        <input type="file" accept="image/*" capture="environment" hidden disabled={disabled} onChange={submit} />
      </label>
      {verdict && (
        <p className="error footnote" role="alert">
          Not a match: {verdict}
        </p>
      )}
      <span className="muted footnote">An AI referee checks it’s the same spot and that you did the twist.</span>
    </div>
  )
}

export default PhotoHuntCard
