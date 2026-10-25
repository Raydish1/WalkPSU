import type { FeatureCollection, Point, Polygon } from 'geojson'
import { useMemo, useState } from 'react'
import { Layer, Popup, Source, type MapLayerMouseEvent } from 'react-map-gl/maplibre'
import Avatar from '../components/Avatar'
import CampusMap from '../components/CampusMap'
import DropSheet from '../components/DropSheet'
import FoundOverlay, { type Found } from '../components/FoundOverlay'
import PlayerSprite from '../components/PlayerSprite'
import { DROP_TYPES } from '../lib/campus'
import type { DropRow } from '../lib/database.types'
import { distanceM } from '../lib/geo'
import { useBuildings, useClaimRadius, useDrops } from '../lib/hooks'
import { circlePolygon } from '../map/geometry'
import { usePresence, type LivePlayer } from '../session/presence'
import { useReadySession } from '../session/session'

const IN_RANGE = '#16a34a'
/** A photo hunt's pin once someone has found it. */
const REVEALED = '#dc2626'
/** How close a tapped drop is framed: about a block across, so its claim circle and building are both visible. */
const DROP_ZOOM = 17

/** A photo hunt nobody has found yet: its lat/lng is only the center of a search circle, so it gets no pin. */
const isHiddenHunt = (d: DropRow) => d.type === 'photo_hunt' && !d.first_found_at
const pinColor = (d: DropRow) => (d.type === 'photo_hunt' ? REVEALED : DROP_TYPES[d.type].color)

function MapPage() {
  const { data: drops, error, refresh: refreshDrops } = useDrops()
  const buildings = useBuildings()
  const radius = useClaimRadius()
  const { position, others } = usePresence()
  const { player } = useReadySession()
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  // The sheet keeps its drop while it slides away, so closing never flashes empty content.
  const [sheet, setSheet] = useState<{ drop: DropRow; open: boolean } | null>(null)
  const [found, setFound] = useState<Found | null>(null)

  const here = position?.coords
  const distanceTo = (d: DropRow) => (here ? distanceM(here.latitude, here.longitude, d.lat, d.lng) : null)
  const highlighted = useMemo(() => new Set(drops.flatMap((d) => (d.building_num ? [d.building_num] : []))), [drops])

  const circles = useMemo<FeatureCollection<Polygon>>(
    () => ({
      type: 'FeatureCollection',
      features:
        radius === null
          ? []
          : drops.filter((d) => !isHiddenHunt(d)).map((d) => {
              const distance = here ? distanceM(here.latitude, here.longitude, d.lat, d.lng) : null
              return {
                type: 'Feature',
                properties: { color: pinColor(d), inRange: distance !== null && distance <= radius },
                geometry: circlePolygon(d.lat, d.lng, radius),
              }
            }),
    }),
    [drops, radius, here],
  )
  const huntAreas = useMemo<FeatureCollection<Polygon>>(
    () => ({
      type: 'FeatureCollection',
      features: drops
        .filter(isHiddenHunt)
        .map((d) => ({ type: 'Feature', properties: { id: d.id }, geometry: circlePolygon(d.lat, d.lng, d.search_radius_m ?? 125) })),
    }),
    [drops],
  )
  const dropPoints = useMemo<FeatureCollection<Point>>(
    () => ({
      type: 'FeatureCollection',
      features: drops
        .filter((d) => !isHiddenHunt(d))
        .map((d) => ({ type: 'Feature', properties: { id: d.id, color: pinColor(d) }, geometry: { type: 'Point', coordinates: [d.lng, d.lat] } })),
    }),
    [drops],
  )
  // Everyone on the map as sprites; me last so my sprite draws on top.
  const sprites = useMemo<LivePlayer[]>(
    () => [
      ...others,
      ...(here ? [{ playerId: player.id, name: player.display_name, color: player.color, lat: here.latitude, lng: here.longitude }] : []),
    ],
    [others, here, player],
  )

  const closeSheet = () => setSheet((s) => s && { ...s, open: false })

  const onClick = (e: MapLayerMouseEvent) => {
    const hit = e.features?.[0]
    const id = hit?.properties?.id as string | undefined
    // An unfound photo hunt is tapped through its search circle; its lat/lng is that circle's center.
    const drop = hit?.layer.id === 'drop-points' || hit?.layer.id === 'hunt-areas' ? drops.find((d) => d.id === id) : undefined
    if (drop) {
      setSelectedPlayerId(null)
      setSheet({ drop, open: true })
      // Lift the tapped drop into the top half of the screen, clear of the sheet, zooming in if the player was
      // zoomed out (never out, if they were closer). A longer glide when it zooms, so the jump reads as one move.
      const zoom = Math.max(e.target.getZoom(), DROP_ZOOM)
      const zooming = zoom - e.target.getZoom() > 0.25
      e.target.easeTo({ center: [drop.lng, drop.lat], zoom, offset: [0, -170], duration: zooming ? 800 : 450 })
    } else {
      closeSheet()
      setSelectedPlayerId(null)
    }
  }

  // Track the live row; a drop that vanishes (claimed, expired) closes its sheet.
  const sheetDrop = sheet && (drops.find((d) => d.id === sheet.drop.id) ?? sheet.drop)
  const sheetOpen = !!sheet?.open && drops.some((d) => d.id === sheet.drop.id)
  const selectedPlayer = selectedPlayerId ? sprites.find((p) => p.playerId === selectedPlayerId) : undefined

  return (
    <div className="map-wrap">
      <CampusMap buildings={buildings} highlighted={highlighted} className="map" interactiveLayerIds={['drop-points', 'hunt-areas']} onClick={onClick}>
        <Source id="hunt-areas" type="geojson" data={huntAreas}>
          <Layer id="hunt-areas" type="fill" paint={{ 'fill-color': DROP_TYPES.photo_hunt.color, 'fill-opacity': 0.14 }} />
          <Layer id="hunt-areas-line" type="line" paint={{ 'line-color': DROP_TYPES.photo_hunt.color, 'line-width': 2.5, 'line-dasharray': [1, 2] }} />
        </Source>
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
        {sprites.map((p) => (
          <PlayerSprite
            key={p.playerId}
            id={p.playerId}
            name={p.name}
            color={p.color}
            lng={p.lng}
            lat={p.lat}
            me={p.playerId === player.id}
            onTap={() => {
              closeSheet()
              setSelectedPlayerId(p.playerId)
            }}
          />
        ))}

        {selectedPlayer && (
          <Popup longitude={selectedPlayer.lng} latitude={selectedPlayer.lat} anchor="bottom" offset={selectedPlayer.playerId === player.id ? 48 : 40} closeButton={false} onClose={() => setSelectedPlayerId(null)} className="map-card is-player">
            <span className="player-tag">
              <Avatar name={selectedPlayer.name} color={selectedPlayer.color} />
              <span className="truncate">{selectedPlayer.playerId === player.id ? `${selectedPlayer.name} (you)` : selectedPlayer.name}</span>
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
        onFound={(points, reason) => {
          if (!sheetDrop) return
          // Only the first finder gets full points; the map's copy of the drop may be a moment stale.
          setFound({ title: sheetDrop.title, points, first: points === sheetDrop.points && !sheetDrop.first_found_at, reason })
          closeSheet()
          refreshDrops()
        }}
      />
      {found && <FoundOverlay found={found} onClose={() => setFound(null)} />}
    </div>
  )
}

export default MapPage
