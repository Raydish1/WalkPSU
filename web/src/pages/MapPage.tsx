import { useState } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'
import BuildingsLayer from '../components/BuildingsLayer'
import { claimDrop } from '../lib/api'
import { CAMPUS_CENTER, DROP_TYPES, OSM_TILES } from '../lib/campus'
import type { DropRow } from '../lib/database.types'
import { useBuildingControl, useBuildings, useDrops, usePosition, useTeams } from '../lib/hooks'

function MapPage() {
  const { data: drops, error, refresh: refreshDrops } = useDrops()
  const { data: control, refresh: refreshControl } = useBuildingControl()
  const buildings = useBuildings()
  const teams = useTeams()
  const position = usePosition()

  return (
    <div className="map-wrap">
      <MapContainer center={CAMPUS_CENTER} zoom={16} className="map" preferCanvas>
        <TileLayer {...OSM_TILES} />
        <BuildingsLayer buildings={buildings} control={control} teams={teams} />
        {drops.map((drop) => (
          <CircleMarker
            key={drop.id}
            center={[drop.lat, drop.lng]}
            radius={14}
            pathOptions={{ color: 'white', weight: 3, fillColor: DROP_TYPES[drop.type].color, fillOpacity: 0.9 }}
          >
            <Popup>
              <DropPopup
                drop={drop}
                position={position}
                onClaimed={() => {
                  refreshDrops()
                  refreshControl()
                }}
              />
            </Popup>
          </CircleMarker>
        ))}
        {position && (
          <CircleMarker
            center={[position.coords.latitude, position.coords.longitude]}
            radius={8}
            pathOptions={{ color: 'white', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}
          />
        )}
      </MapContainer>
      {error && <div className="map-banner error">{error}</div>}
    </div>
  )
}

type DropPopupProps = { drop: DropRow; position: GeolocationPosition | null; onClaimed: () => void }

function DropPopup({ drop, position, onClaimed }: DropPopupProps) {
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function claim() {
    if (!position) {
      setMessage('No GPS fix yet. Scan the drop’s QR code to claim it.')
      return
    }
    setBusy(true)
    try {
      await claimDrop(drop.id, { lat: position.coords.latitude, lng: position.coords.longitude })
      setMessage(`Claimed! +${drop.points} for your team`)
      onClaimed()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack-sm">
      <strong>{drop.title}</strong>
      <span className="muted">
        {DROP_TYPES[drop.type].label} · {drop.points} pts
      </span>
      {drop.hint_photo_url && <img className="hint-photo" src={drop.hint_photo_url} alt="Hint" />}
      <button className="button primary" onClick={claim} disabled={busy}>
        {busy ? 'Claiming…' : 'Claim'}
      </button>
      {message && <span>{message}</span>}
    </div>
  )
}

export default MapPage
