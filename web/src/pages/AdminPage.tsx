import { useState, type FormEvent } from 'react'
import { CircleMarker, MapContainer, TileLayer, useMapEvents } from 'react-leaflet'
import { createDrop, uploadHintPhoto } from '../lib/api'
import { CAMPUS_CENTER, DROP_TYPES, OSM_TILES } from '../lib/campus'
import type { DropType } from '../lib/database.types'
import { useDrops } from '../lib/hooks'
import { useReadySession } from '../session/session'

function PickLocation({ onPick }: { onPick: (latlng: [number, number]) => void }) {
  useMapEvents({ click: (e) => onPick([e.latlng.lat, e.latlng.lng]) })
  return null
}

function AdminPage() {
  const { player, isAdmin } = useReadySession()
  const { data: drops } = useDrops()
  const [location, setLocation] = useState<[number, number] | null>(null)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<DropType>('minigame')
  const [points, setPoints] = useState(10)
  const [minutes, setMinutes] = useState(30)
  const [photo, setPhoto] = useState<File | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!isAdmin) {
    return (
      <section className="page stack">
        <h1>Admins only</h1>
        <p className="muted">Ask an organizer to make you an admin.</p>
      </section>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!location) return
    setBusy(true)
    setStatus(null)
    try {
      const hint_photo_url = photo ? await uploadHintPhoto(photo) : null
      await createDrop({
        title: title.trim(),
        type,
        points,
        lat: location[0],
        lng: location[1],
        hint_photo_url,
        created_by: player.id,
        expires_at: minutes > 0 ? new Date(Date.now() + minutes * 60_000).toISOString() : null,
      })
      setStatus(`Dropped "${title.trim()}"`)
      setTitle('')
      setPhoto(null)
      setLocation(null)
    } catch (err) {
      setStatus((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page stack">
      <h1>Drop an event</h1>
      <p className="muted">Tap the map to place it.</p>
      <MapContainer center={CAMPUS_CENTER} zoom={16} className="admin-map">
        <TileLayer {...OSM_TILES} />
        <PickLocation onPick={setLocation} />
        {drops.map((d) => (
          <CircleMarker key={d.id} center={[d.lat, d.lng]} radius={8} pathOptions={{ color: DROP_TYPES[d.type].color }} />
        ))}
        {location && (
          <CircleMarker center={location} radius={12} pathOptions={{ color: '#111', fillColor: '#facc15', fillOpacity: 1 }} />
        )}
      </MapContainer>
      <form className="stack" onSubmit={submit}>
        <label className="stack-sm">
          Title
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="stack-sm">
          Type
          <select className="input" value={type} onChange={(e) => setType(e.target.value as DropType)}>
            {Object.entries(DROP_TYPES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <label className="stack-sm">
            Points
            <input className="input" type="number" min={1} value={points} onChange={(e) => setPoints(Number(e.target.value))} />
          </label>
          <label className="stack-sm">
            Expires in min (0 = never)
            <input className="input" type="number" min={0} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </label>
        </div>
        <label className="stack-sm">
          Hint photo (optional)
          <input className="input" type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
        {status && <p>{status}</p>}
        <button className="button primary" disabled={busy || !location || !title.trim()}>
          {busy ? 'Dropping…' : location ? 'Drop it' : 'Tap the map first'}
        </button>
      </form>
    </section>
  )
}

export default AdminPage
