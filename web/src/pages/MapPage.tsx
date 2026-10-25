import type { FeatureCollection, Point, Polygon } from 'geojson'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Layer, Popup, Source, useMap, type MapLayerMouseEvent } from 'react-map-gl/maplibre'
import { Link } from 'react-router'
import { toast } from 'sonner'
import Avatar from '../components/Avatar'
import BuildingSheet from '../components/BuildingSheet'
import CampusMap from '../components/CampusMap'
import MissionCard from '../components/MissionCard'
import PlayerHud from '../components/PlayerHud'
import { PinIcon } from '../components/icons'
import { claimDrop } from '../lib/api'
import type { Building } from '../lib/buildings'
import { DROP_TYPES } from '../lib/campus'
import type { DropRow } from '../lib/database.types'
import { distanceM } from '../lib/geo'
import { useBuildings, useClaimRadius, useDrops, useLeaderboard } from '../lib/hooks'
import { circlePolygon } from '../map/geometry'
import { usePresence } from '../session/presence'
import { useReadySession } from '../session/session'

const IN_RANGE = '#5ba8e0'
const ME = '#7eb6e8'

type Selected =
  | { kind: 'drop'; id: string }
  | { kind: 'player'; id: string }
  | { kind: 'building'; num: string }
  | null

function FlyTo({ lng, lat, token }: { lng: number; lat: number; token: number }) {
  const { current: map } = useMap()
  useEffect(() => {
    if (!map || token === 0) return
    map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 17), duration: 800 })
  }, [map, lng, lat, token])
  return null
}

function MapPage() {
  const { player } = useReadySession()
  const { data: drops, error, refresh: refreshDrops } = useDrops()
  const { data: scores } = useLeaderboard()
  const buildings = useBuildings()
  const radius = useClaimRadius()
  const { position, others } = usePresence()
  const [selected, setSelected] = useState<Selected>(null)
  const [flyToken, setFlyToken] = useState(0)

  const here = position?.coords
  const distanceTo = (d: DropRow) => (here ? distanceM(here.latitude, here.longitude, d.lat, d.lng) : null)
  const highlighted = useMemo(() => new Set(drops.flatMap((d) => (d.building_num ? [d.building_num] : []))), [drops])
  const highlightColors = useMemo(() => {
    const colors = new Map<string, string>()
    for (const d of drops) {
      if (d.building_num) colors.set(d.building_num, DROP_TYPES[d.type].color)
    }
    return colors
  }, [drops])

  const myScore = scores.find((s) => s.player_id === player.id)
  const mission = useMemo(() => {
    const hub = drops.find((d) => /hub/i.test(d.title))
    return hub ?? drops[0] ?? null
  }, [drops])

  const selectedBuilding = useMemo(() => {
    if (selected?.kind === 'building') return buildings.find((b) => b.properties.num === selected.num) ?? null
    if (selected?.kind === 'drop') {
      const drop = drops.find((d) => d.id === selected.id)
      return drop?.building_num ? buildings.find((b) => b.properties.num === drop.building_num) ?? null : null
    }
    return null
  }, [selected, buildings, drops])

  const sheetDrop = useMemo(() => {
    if (selectedBuilding) return drops.find((d) => d.building_num === selectedBuilding.properties.num) ?? null
    return selected?.kind === 'drop' ? drops.find((d) => d.id === selected.id) ?? null : null
  }, [selected, selectedBuilding, drops])

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
    const num = hit?.properties?.num as string | undefined
    if (hit?.layer.id === 'drop-points' && id) {
      setSelected({ kind: 'drop', id })
      if (hit.geometry.type === 'Point') e.target.easeTo({ center: hit.geometry.coordinates as [number, number], offset: [0, 140], duration: 450 })
    } else if (hit?.layer.id === 'players' && id) {
      setSelected({ kind: 'player', id })
      if (hit.geometry.type === 'Point') e.target.easeTo({ center: hit.geometry.coordinates as [number, number], offset: [0, 140], duration: 450 })
    } else if ((hit?.layer.id === 'buildings-active' || hit?.layer.id === 'buildings-base') && num) {
      setSelected({ kind: 'building', num })
    } else setSelected(null)
  }

  const selectedDrop = selected?.kind === 'drop' ? drops.find((d) => d.id === selected.id) : undefined
  const selectedPlayer = selected?.kind === 'player' ? others.find((p) => p.playerId === selected.id) : undefined
  const showSheet = Boolean(selectedBuilding || (selected?.kind === 'drop' && sheetDrop))

  const focusMission = () => {
    if (!mission) return
    if (mission.building_num) setSelected({ kind: 'building', num: mission.building_num })
    else setSelected({ kind: 'drop', id: mission.id })
    setFlyToken((n) => n + 1)
  }

  useEffect(() => {
    const num = new URLSearchParams(window.location.search).get('building')
    if (!num || buildings.length === 0) return
    if (buildings.some((b) => b.properties.num === num)) {
      setSelected({ kind: 'building', num })
      setFlyToken((n) => n + 1)
    }
  }, [buildings])

  return (
    <div className="map-wrap game-map">
      <CampusMap
        buildings={buildings}
        highlighted={highlighted}
        highlightColors={highlightColors}
        className="map"
        interactiveLayerIds={['drop-points', 'players', 'buildings-active', 'buildings-base']}
        onClick={onClick}
      >
        {mission && <FlyTo lng={mission.lng} lat={mission.lat} token={flyToken} />}
        <Source id="claim-circles" type="geojson" data={circles}>
          <Layer
            id="claim-circles-fill"
            type="fill"
            paint={{ 'fill-color': ['case', ['get', 'inRange'], IN_RANGE, ['get', 'color']], 'fill-opacity': ['case', ['get', 'inRange'], 0.22, 0.1] }}
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

        {selectedDrop && !showSheet && (
          <Popup longitude={selectedDrop.lng} latitude={selectedDrop.lat} anchor="bottom" offset={18} closeButton={false} onClose={() => setSelected(null)} className="map-card">
            <DropCard drop={selectedDrop} distance={distanceTo(selectedDrop)} radius={radius} position={position} onClaimed={refreshDrops} />
          </Popup>
        )}
        {selectedPlayer && (
          <Popup longitude={selectedPlayer.lng} latitude={selectedPlayer.lat} anchor="bottom" offset={12} closeButton={false} onClose={() => setSelected(null)} className="map-card is-player">
            <span className="player-tag">
              <Avatar name={selectedPlayer.name} color={selectedPlayer.color} />
              <span className="truncate">{selectedPlayer.name}</span>
            </span>
          </Popup>
        )}
      </CampusMap>

      <div className="map-hud">
        <PlayerHud player={player} points={myScore?.points ?? 0} claims={myScore?.claims ?? 0} />
        <MissionCard drop={mission} onFocus={focusMission} />
      </div>

      <div className="map-top">
        <span className="map-pill glass" role="status">
          <span className="live-dot" data-off={drops.length === 0 || undefined} aria-hidden />
          {drops.length === 0 ? 'No live drops' : `${drops.length} live ${drops.length === 1 ? 'drop' : 'drops'}`}
        </span>
        {error && <div className="map-banner glass error">{error}</div>}
      </div>

      {showSheet && selectedBuilding && <BuildingSheet building={selectedBuilding} drop={sheetDrop} onClose={() => setSelected(null)} />}
      {showSheet && !selectedBuilding && sheetDrop && (
        <BuildingSheet
          building={
            {
              type: 'Feature',
              properties: { num: sheetDrop.building_num ?? sheetDrop.id, name: sheetDrop.title, lat: sheetDrop.lat, lng: sheetDrop.lng },
              geometry: { type: 'Polygon', coordinates: [] },
            } as Building
          }
          drop={sheetDrop}
          onClose={() => setSelected(null)}
        />
      )}
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
      <h3>{drop.title}</h3>
      {drop.hint_photo_url && <img className="hint-photo" src={drop.hint_photo_url} alt="Hint" />}
      {drop.type === 'minigame' && <p className="muted">Two random teams race to shake the hardest. Every winner gets the points.</p>}
      <span className="range" data-in={inRange || undefined}>
        <PinIcon size={16} />
        {range}
      </span>
      {drop.type === 'minigame' ? (
        <Link className="button primary" to={`/game/${drop.id}`}>
          Start Challenge
        </Link>
      ) : (
        <>
          <button className="button primary" onClick={claim} disabled={busy || !inRange}>
            {busy ? 'Claiming…' : 'Start Challenge'}
          </button>
          <span className="muted footnote">Indoors? Scan the drop’s QR code to claim from anywhere.</span>
        </>
      )}
    </div>
  )
}

export default MapPage
