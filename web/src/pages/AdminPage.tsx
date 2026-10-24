import { useMemo, useState, type FormEvent } from 'react'
import { CircleMarker, useMapEvents } from 'react-leaflet'
import BuildingPicker from '../components/BuildingPicker'
import BuildingsLayer from '../components/BuildingsLayer'
import CampusMap from '../components/CampusMap'
import DropQrList from '../components/DropQrList'
import { createDrop, uploadHintPhoto } from '../lib/api'
import { findBuildingAt, type Building } from '../lib/buildings'
import { DROP_TYPES } from '../lib/campus'
import type { DropType, NewDrop } from '../lib/database.types'
import { useBuildingControl, useBuildings, useDrops, usePlayers } from '../lib/hooks'
import { useReadySession } from '../session/session'

type Target = { lat: number; lng: number; building: Building | null }

function TapToPick({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) })
  return null
}

function currentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) reject(new Error('This device has no GPS'))
    else navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10_000 })
  })
}

function AdminPage() {
  const { player, isAdmin } = useReadySession()
  const { data: drops, refresh: refreshDrops } = useDrops()
  const { data: control } = useBuildingControl()
  const buildings = useBuildings()
  const { data: players } = usePlayers()
  const [target, setTarget] = useState<Target | null>(null)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<DropType>('minigame')
  const [points, setPoints] = useState(10)
  const [minutes, setMinutes] = useState(30)
  const [photo, setPhoto] = useState<File | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const namesByNum = useMemo(() => new Map(buildings.map((b) => [b.properties.num, b.properties.name])), [buildings])

  if (!isAdmin) {
    return (
      <section className="page stack">
        <h1>Admins only</h1>
        <p className="muted">Ask an organizer to make you an admin.</p>
      </section>
    )
  }

  function pickBuilding(building: Building) {
    setTarget({ lat: building.properties.lat, lng: building.properties.lng, building })
    if (!title.trim()) setTitle(building.properties.name)
  }

  function pickPoint(lat: number, lng: number) {
    const building = findBuildingAt(buildings, lat, lng) ?? null
    setTarget({ lat, lng, building })
    if (building && !title.trim()) setTitle(building.properties.name)
  }

  async function drop(fields: () => Promise<NewDrop> | NewDrop, label: string) {
    setBusy(true)
    setStatus(null)
    try {
      await createDrop({ ...(await fields()), created_by: player.id })
      setStatus(`Dropped "${label}"`)
      refreshDrops()
      return true
    } catch (err) {
      setStatus((err as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!target) return
    const ok = await drop(
      async () => ({
        title: title.trim(),
        type,
        points,
        lat: target.lat,
        lng: target.lng,
        building_num: target.building?.properties.num ?? null,
        hint_photo_url: photo ? await uploadHintPhoto(photo) : null,
        expires_at: minutes > 0 ? new Date(Date.now() + minutes * 60_000).toISOString() : null,
      }),
      title.trim(),
    )
    if (ok) {
      setTitle('')
      setPhoto(null)
      setTarget(null)
    }
  }

  async function demoDropHere() {
    setStatus('Getting your location…')
    let position: GeolocationPosition
    try {
      position = await currentPosition()
    } catch (err) {
      setStatus(`Location failed: ${(err as GeolocationPositionError | Error).message}`)
      return
    }
    const { latitude: lat, longitude: lng } = position.coords
    const building = findBuildingAt(buildings, lat, lng)
    const label = building ? `Demo: ${building.properties.name}` : 'Demo drop'
    await drop(() => ({ title: label, type: 'checkin', points: 10, lat, lng, building_num: building?.properties.num ?? null }), label)
  }

  return (
    <section className="page stack">
      <h1>Admin</h1>

      <button type="button" className="button primary" onClick={demoDropHere} disabled={busy}>
        📍 Demo drop here
      </button>
      {status && <p>{status}</p>}

      <h2>New drop</h2>
      <BuildingPicker buildings={buildings} onPick={pickBuilding} />
      <p className="muted">
        {target
          ? target.building
            ? `At ${target.building.properties.name} (captures it)`
            : 'Open-ground drop (no building)'
          : 'Search a building above or tap the map.'}
      </p>
      <CampusMap buildings={buildings} className="admin-map">
        <BuildingsLayer buildings={buildings} control={control} players={players} interactive={false} />
        <TapToPick onPick={pickPoint} />
        {drops.map((d) => (
          <CircleMarker key={d.id} center={[d.lat, d.lng]} radius={8} pathOptions={{ color: DROP_TYPES[d.type].color }} />
        ))}
        {target && (
          <CircleMarker center={[target.lat, target.lng]} radius={12} pathOptions={{ color: '#111', fillColor: '#facc15', fillOpacity: 1 }} />
        )}
      </CampusMap>
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
        <button className="button primary" disabled={busy || !target || !title.trim()}>
          {busy ? 'Dropping…' : target ? 'Drop it' : 'Pick a spot first'}
        </button>
      </form>

      <h2>QR codes</h2>
      <DropQrList drops={drops} buildingName={(num) => namesByNum.get(num)} />
    </section>
  )
}

export default AdminPage
