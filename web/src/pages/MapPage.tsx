import type { FeatureCollection, Point, Polygon } from 'geojson'
import { useMemo, useState } from 'react'
import { Layer, Popup, Source, type MapLayerMouseEvent } from 'react-map-gl/maplibre'
import { Link } from 'react-router'
import CampusMap from '../components/CampusMap'
import { claimDrop } from '../lib/api'
import { DROP_TYPES } from '../lib/campus'
import type { DropRow } from '../lib/database.types'
import { distanceM } from '../lib/geo'
import { useBuildings, useClaimRadius, useDrops } from '../lib/hooks'
import { circlePolygon } from '../map/geometry'
import { usePresence } from '../session/presence'

const IN_RANGE = '#16a34a'
const ME = '#2563eb'

type Selected = { kind: 'drop'; id: string } | { kind: 'player'; id: string } | null

function MapPage() {
  const { data: drops, error, refresh: refreshDrops } = useDrops()
  const buildings = useBuildings()
  const radius = useClaimRadius()
  const { position, others } = usePresence()
  const [selected, setSelected] = useState<Selected>(null)

  const here = position?.coords
  const distanceTo = (d: DropRow) => (here ? distanceM(here.latitude, here.longitude, d.lat, d.lng) : null)
  const highlighted = useMemo(() => new Set(drops.flatMap((d) => (d.building_num ? [d.building_num] : []))), [drops])

  const circles = useMemo<FeatureCollection<Polygon>>(
    () => ({
      type: 'FeatureCollection',
      features:
        radius === null
          ? []
          : drops.map((d) => {
              const distance = here ? distanceM(here.latitude, here.longitude, d.lat, d.lng) : null
              return {
                type: 'Feature',
                properties: { color: DROP_TYPES[d.type].color, inRange: distance !== null && distance <= radius },
                geometry: circlePolygon(d.lat, d.lng, radius),
              }
            }),
    }),
    [drops, radius, here],
  )
  const dropPoints = useMemo<FeatureCollection<Point>>(
    () => ({
      type: 'FeatureCollection',
      features: drops.map((d) => ({ type: 'Feature', properties: { id: d.id, color: DROP_TYPES[d.type].color }, geometry: { type: 'Point', coordinates: [d.lng, d.lat] } })),
    }),
    [drops],
  )
  const playerPoints = useMemo<FeatureCollection<Point>>(
    () => ({
      type: 'FeatureCollection',
      features: others.map((p) => ({ type: 'Feature', properties: { id: p.playerId, color: p.color }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })),
    }),
    [others],
  )
  const me = useMemo<FeatureCollection<Point>>(
    () => ({ type: 'FeatureCollection', features: here ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [here.longitude, here.latitude] } }] : [] }),
    [here],
  )

  const onClick = (e: MapLayerMouseEvent) => {
    const hit = e.features?.[0]
    const id = hit?.properties?.id as string | undefined
    if (hit?.layer.id === 'drop-points' && id) setSelected({ kind: 'drop', id })
    else if (hit?.layer.id === 'players' && id) setSelected({ kind: 'player', id })
    else setSelected(null)
  }

  const selectedDrop = selected?.kind === 'drop' ? drops.find((d) => d.id === selected.id) : undefined
  const selectedPlayer = selected?.kind === 'player' ? others.find((p) => p.playerId === selected.id) : undefined

  return (
    <div className="map-wrap">
      <CampusMap buildings={buildings} highlighted={highlighted} className="map" interactiveLayerIds={['drop-points', 'players']} onClick={onClick}>
        <Source id="claim-circles" type="geojson" data={circles}>
          <Layer
            id="claim-circles-fill"
            type="fill"
            paint={{ 'fill-color': ['case', ['get', 'inRange'], IN_RANGE, ['get', 'color']], 'fill-opacity': ['case', ['get', 'inRange'], 0.25, 0.08] }}
          />
          <Layer id="claim-circles-out" type="line" filter={['!', ['get', 'inRange']]} paint={{ 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-dasharray': [3, 3] }} />
          <Layer id="claim-circles-in" type="line" filter={['get', 'inRange']} paint={{ 'line-color': IN_RANGE, 'line-width': 3 }} />
        </Source>
        <Source id="drops" type="geojson" data={dropPoints}>
          <Layer
            id="drop-points"
            type="circle"
            paint={{ 'circle-radius': 11, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 }}
          />
        </Source>
        <Source id="players" type="geojson" data={playerPoints}>
          <Layer id="players" type="circle" paint={{ 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 }} />
        </Source>
        <Source id="me" type="geojson" data={me}>
          <Layer id="me-halo" type="circle" paint={{ 'circle-radius': 18, 'circle-color': ME, 'circle-opacity': 0.18 }} />
          <Layer id="me-dot" type="circle" paint={{ 'circle-radius': 8, 'circle-color': ME, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 }} />
        </Source>

        {selectedDrop && (
          <Popup longitude={selectedDrop.lng} latitude={selectedDrop.lat} anchor="bottom" offset={18} closeButton={false} onClose={() => setSelected(null)} className="map-card">
            <DropCard drop={selectedDrop} distance={distanceTo(selectedDrop)} radius={radius} position={position} onClaimed={refreshDrops} />
          </Popup>
        )}
        {selectedPlayer && (
          <Popup longitude={selectedPlayer.lng} latitude={selectedPlayer.lat} anchor="bottom" offset={12} closeButton={false} onClose={() => setSelected(null)} className="map-card">
            <strong>{selectedPlayer.name}</strong>
          </Popup>
        )}
      </CampusMap>
      {error && <div className="map-banner error">{error}</div>}
    </div>
  )
}

type DropCardProps = {
  drop: DropRow
  distance: number | null
  radius: number | null
  position: GeolocationPosition | null
  onClaimed: () => void
}

function DropCard({ drop, distance, radius, position, onClaimed }: DropCardProps) {
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inRange = radius !== null && distance !== null && distance <= radius

  async function claim() {
    if (!position) return
    setBusy(true)
    try {
      await claimDrop(drop.id, { lat: position.coords.latitude, lng: position.coords.longitude })
      setMessage(`Claimed! +${drop.points} points`)
      onClaimed()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const hint =
    distance === null
      ? 'Waiting for GPS…'
      : inRange
        ? 'You’re in range!'
        : `${Math.round(distance)} m away. Get within ${radius ?? '…'} m to claim.`

  return (
    <div className="stack-sm">
      <strong>{drop.title}</strong>
      <span className="muted">
        {DROP_TYPES[drop.type].label} · {drop.points} pts
      </span>
      {drop.hint_photo_url && <img className="hint-photo" src={drop.hint_photo_url} alt="Hint" />}
      {drop.type === 'minigame' ? (
        <>
          <span>Shake-Off: two random teams, 15 seconds of shaking. Every winner gets the points.</span>
          <Link className="button primary" to={`/game/${drop.id}`}>
            Open the lobby
          </Link>
          <span className="muted">{inRange ? 'You’re in range to join!' : hint.replace('to claim', 'to join')}</span>
        </>
      ) : (
        <>
          <button className="button primary" onClick={claim} disabled={busy || !inRange}>
            {busy ? 'Claiming…' : 'Claim'}
          </button>
          <span className="muted">{hint}</span>
          <span className="muted">Indoors? Scan the drop’s QR code to claim from anywhere.</span>
          {message && <span>{message}</span>}
        </>
      )}
    </div>
  )
}

export default MapPage
