import { Fragment, useState } from 'react'
import { Circle, CircleMarker, Popup } from 'react-leaflet'
import BuildingsLayer from '../components/BuildingsLayer'
import CampusMap from '../components/CampusMap'
import { claimDrop } from '../lib/api'
import { DROP_TYPES } from '../lib/campus'
import type { DropRow } from '../lib/database.types'
import { distanceM } from '../lib/geo'
import { useBuildingControl, useBuildings, useClaimRadius, useDrops, usePlayers } from '../lib/hooks'
import { usePresence } from '../session/presence'

function MapPage() {
  const { data: drops, error, refresh: refreshDrops } = useDrops()
  const { data: control, refresh: refreshControl } = useBuildingControl()
  const { data: players, refresh: refreshPlayers } = usePlayers()
  const buildings = useBuildings()
  const radius = useClaimRadius()
  const { position, others } = usePresence()

  const onClaimed = () => {
    refreshDrops()
    refreshControl()
    refreshPlayers()
  }

  return (
    <div className="map-wrap">
      <CampusMap buildings={buildings} className="map">
        <BuildingsLayer buildings={buildings} control={control} players={players} />
        {drops.map((drop) => {
          const distance = position ? distanceM(position.coords.latitude, position.coords.longitude, drop.lat, drop.lng) : null
          const inRange = radius !== null && distance !== null && distance <= radius
          const color = DROP_TYPES[drop.type].color
          return (
            <Fragment key={drop.id}>
              {radius !== null && (
                <Circle
                  center={[drop.lat, drop.lng]}
                  radius={radius}
                  interactive={false}
                  pathOptions={
                    inRange
                      ? { color: '#16a34a', weight: 3, fillColor: '#22c55e', fillOpacity: 0.3 }
                      : { color, weight: 1.5, dashArray: '6 6', fillColor: color, fillOpacity: 0.08 }
                  }
                />
              )}
              <CircleMarker
                center={[drop.lat, drop.lng]}
                radius={14}
                pathOptions={{ color: 'white', weight: 3, fillColor: color, fillOpacity: 0.9 }}
              >
                <Popup>
                  <DropPopup drop={drop} distance={distance} radius={radius} position={position} onClaimed={onClaimed} />
                </Popup>
              </CircleMarker>
            </Fragment>
          )
        })}
        {others.map((p) => (
          <CircleMarker
            key={p.playerId}
            center={[p.lat, p.lng]}
            radius={7}
            pathOptions={{ color: 'white', weight: 2, fillColor: p.color, fillOpacity: 1 }}
          >
            <Popup>{p.name}</Popup>
          </CircleMarker>
        ))}
        {position && (
          <CircleMarker
            center={[position.coords.latitude, position.coords.longitude]}
            radius={8}
            pathOptions={{ color: 'white', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}
          >
            <Popup>You</Popup>
          </CircleMarker>
        )}
      </CampusMap>
      {error && <div className="map-banner error">{error}</div>}
    </div>
  )
}

type DropPopupProps = {
  drop: DropRow
  distance: number | null
  radius: number | null
  position: GeolocationPosition | null
  onClaimed: () => void
}

function DropPopup({ drop, distance, radius, position, onClaimed }: DropPopupProps) {
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
      <button className="button primary" onClick={claim} disabled={busy || !inRange}>
        {busy ? 'Claiming…' : 'Claim'}
      </button>
      <span className="muted">{hint}</span>
      <span className="muted">Indoors? Scan the drop’s QR code to claim from anywhere.</span>
      {message && <span>{message}</span>}
    </div>
  )
}

export default MapPage
