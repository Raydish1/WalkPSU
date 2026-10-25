import { useMemo, useState, type FormEvent } from 'react'
import type { FeatureCollection, Point } from 'geojson'
import { Layer, Source } from 'react-map-gl/maplibre'
import { toast } from 'sonner'
import BuildingPicker from '../components/BuildingPicker'
import CampusMap from '../components/CampusMap'
import { PinIcon } from '../components/icons'
import DropQrList from '../components/DropQrList'
import { createDrop, uploadHintPhoto } from '../lib/api'
import { findBuildingAt, type Building } from '../lib/buildings'
import { DROP_TYPES, dropTypeMeta } from '../lib/campus'
import type { DropType, NewDrop } from '../lib/database.types'
import { EVENT_CATEGORIES, type EventCategoryId } from '../lib/events'
import { useBuildings, useDrops } from '../lib/hooks'
import { useReadySession } from '../session/session'

type Target = { lat: number; lng: number; building: Building | null }

const toPoints = (items: { lat: number; lng: number; color: string }[]): FeatureCollection<Point> => ({
  type: 'FeatureCollection',
  features: items.map(({ lat, lng, color }) => ({ type: 'Feature', properties: { color }, geometry: { type: 'Point', coordinates: [lng, lat] } })),
})

function currentPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) reject(new Error('This device has no GPS'))
    else navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10_000 })
  })
}

function AdminPage() {
  const { player, isAdmin } = useReadySession()
  const { data: drops, refresh: refreshDrops } = useDrops()
  const buildings = useBuildings()
  const [target, setTarget] = useState<Target | null>(null)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<DropType>('minigame')
  const [category, setCategory] = useState<EventCategoryId>('campus')
  const [points, setPoints] = useState(10)
  const [minutes, setMinutes] = useState(30)
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const namesByNum = useMemo(() => new Map(buildings.map((b) => [b.properties.num, b.properties.name])), [buildings])
  const highlighted = useMemo(() => new Set(drops.flatMap((d) => (d.building_num ? [d.building_num] : []))), [drops])
  const dropPoints = useMemo(() => toPoints(drops.map((d) => ({ lat: d.lat, lng: d.lng, color: dropTypeMeta(d.type).color }))), [drops])
  const targetPoint = useMemo(() => toPoints(target ? [{ lat: target.lat, lng: target.lng, color: '#facc15' }] : []), [target])

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

  async function drop(fields: () => Promise<NewDrop> | NewDrop, label: string, toastId?: string | number) {
    setBusy(true)
    try {
      await createDrop({ ...(await fields()), created_by: player.id })
      toast.success('Dropped', { id: toastId, description: label })
      refreshDrops()
      return true
    } catch (err) {
      toast.error('Couldn’t drop it', { id: toastId, description: (err as Error).message })
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
        category,
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
      setCategory('campus')
      setPhoto(null)
      setTarget(null)
    }
  }

  async function demoDropHere() {
    const toastId = toast.loading('Getting your location…')
    let position: GeolocationPosition
    try {
      position = await currentPosition()
    } catch (err) {
      toast.error('Location failed', { id: toastId, description: (err as GeolocationPositionError | Error).message })
      return
    }
    const { latitude: lat, longitude: lng } = position.coords
    const building = findBuildingAt(buildings, lat, lng)
    const label = building ? `Demo: ${building.properties.name}` : 'Demo drop'
    await drop(
      () => ({ title: label, type: 'checkin', category: 'campus', points: 10, lat, lng, building_num: building?.properties.num ?? null }),
      label,
      toastId,
    )
  }

  return (
    <section className="page stack">
      <h1>Admin</h1>

      <div className="card stack-sm">
        <button type="button" className="button primary" onClick={demoDropHere} disabled={busy}>
          <PinIcon size={20} />
          Demo drop here
        </button>
        <span className="muted footnote">A 10-point check-in at your current location.</span>
      </div>

      <h2>New drop</h2>
      <BuildingPicker buildings={buildings} onPick={pickBuilding} />
      <p className="muted footnote">
        {target
          ? target.building
            ? `At ${target.building.properties.name}`
            : 'Open-ground drop (no building)'
          : 'Search a building above or tap the map.'}
      </p>
      <CampusMap buildings={buildings} highlighted={highlighted} className="admin-map" onClick={(e) => pickPoint(e.lngLat.lat, e.lngLat.lng)}>
        <Source id="admin-drops" type="geojson" data={dropPoints}>
          <Layer id="admin-drops" type="circle" paint={{ 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 }} />
        </Source>
        <Source id="admin-target" type="geojson" data={targetPoint}>
          <Layer id="admin-target" type="circle" paint={{ 'circle-radius': 11, 'circle-color': '#facc15', 'circle-stroke-color': '#111827', 'circle-stroke-width': 2 }} />
        </Source>
      </CampusMap>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          Title
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} enterKeyHint="done" required />
        </label>
        <label className="field">
          Type
          <select className="input" value={type} onChange={(e) => setType(e.target.value as DropType)}>
            {Object.entries(DROP_TYPES).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Event theme
          <select className="input" value={category} onChange={(e) => setCategory(e.target.value as EventCategoryId)}>
            {(Object.keys(EVENT_CATEGORIES) as EventCategoryId[]).map((id) => (
              <option key={id} value={id}>
                {EVENT_CATEGORIES[id].label}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <label className="field">
            Points
            <input className="input" type="number" inputMode="numeric" min={1} value={points} onChange={(e) => setPoints(Number(e.target.value))} />
          </label>
          <label className="field">
            Expires in min (0 = never)
            <input className="input" type="number" inputMode="numeric" min={0} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </label>
        </div>
        <label className="field">
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
