import type { FeatureCollection, Point, Polygon } from 'geojson'
import { useMemo, useState } from 'react'
import { Layer, Popup, Source, type MapLayerMouseEvent } from 'react-map-gl/maplibre'
import Avatar from '../components/Avatar'
import CampusMap from '../components/CampusMap'
import DropSheet from '../components/DropSheet'
import { DROP_TYPES } from '../lib/campus'
import type { DropRow } from '../lib/database.types'
import { distanceM } from '../lib/geo'
import { useBuildings, useClaimRadius, useDrops } from '../lib/hooks'
import { circlePolygon } from '../map/geometry'
import { usePresence } from '../session/presence'

const IN_RANGE = '#16a34a'
const ME = '#2563eb'


function MapPage() {
  const { data: drops, error, refresh: refreshDrops } = useDrops()
  const buildings = useBuildings()
  const radius = useClaimRadius()
  const { position, others } = usePresence()
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  // The sheet keeps its drop while it slides away, so closing never flashes empty content.
  const [sheet, setSheet] = useState<{ drop: DropRow; open: boolean } | null>(null)

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

  const closeSheet = () => setSheet((s) => s && { ...s, open: false })

  const onClick = (e: MapLayerMouseEvent) => {
    const hit = e.features?.[0]
    const id = hit?.properties?.id as string | undefined
    const drop = hit?.layer.id === 'drop-points' ? drops.find((d) => d.id === id) : undefined
    if (drop) {
      setSelectedPlayerId(null)
      setSheet({ drop, open: true })
      // Lift the tapped drop into the top half of the screen, clear of the sheet.
      e.target.easeTo({ center: [drop.lng, drop.lat], offset: [0, -170], duration: 450 })
    } else if (hit?.layer.id === 'players' && id) {
      closeSheet()
      setSelectedPlayerId(id)
    } else {
      closeSheet()
      setSelectedPlayerId(null)
    }
  }

  // Track the live row; a drop that vanishes (claimed, expired) closes its sheet.
  const sheetDrop = sheet && (drops.find((d) => d.id === sheet.drop.id) ?? sheet.drop)
  const sheetOpen = !!sheet?.open && drops.some((d) => d.id === sheet.drop.id)
  const selectedPlayer = selectedPlayerId ? others.find((p) => p.playerId === selectedPlayerId) : undefined

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

        {selectedPlayer && (
          <Popup longitude={selectedPlayer.lng} latitude={selectedPlayer.lat} anchor="bottom" offset={12} closeButton={false} onClose={() => setSelectedPlayerId(null)} className="map-card is-player">
            <span className="player-tag">
              <Avatar name={selectedPlayer.name} color={selectedPlayer.color} />
              <span className="truncate">{selectedPlayer.name}</span>
            </span>
          </Popup>
        )}
      </CampusMap>
      <div className="map-top">
        <span className="map-pill glass" role="status">
          <span className="live-dot" data-off={drops.length === 0 || undefined} aria-hidden />
          {drops.length === 0 ? 'No live drops' : `${drops.length} live ${drops.length === 1 ? 'drop' : 'drops'}`}
        </span>
        {error && <div className="map-banner glass error">{error}</div>}
      </div>
      <DropSheet
        drop={sheetDrop}
        open={sheetOpen}
        distance={sheetDrop ? distanceTo(sheetDrop) : null}
        radius={radius}
        position={position}
        onClose={closeSheet}
        onClaimed={() => {
          closeSheet()
          refreshDrops()
        }}
      />
    </div>
  )
}

export default MapPage
