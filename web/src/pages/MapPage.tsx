import { useState } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'
import { claimDrop } from '../lib/api'
import { CAMPUS_CENTER, DROP_TYPES, OSM_TILES } from '../lib/campus'
import type { DropRow } from '../lib/database.types'
import { useDrops, usePosition } from '../lib/hooks'

function MapPage() {
  const { data: drops, error } = useDrops()
  const position = usePosition()

  return (
    <div className="map-wrap">
      <MapContainer center={CAMPUS_CENTER} zoom={16} className="map">
        <TileLayer {...OSM_TILES} />
        {drops.map((drop) => (
          <CircleMarker
            key={drop.id}
            center={[drop.lat, drop.lng]}
            radius={14}
            pathOptions={{ color: 'white', weight: 3, fillColor: DROP_TYPES[drop.type].color, fillOpacity: 0.9 }}
          >
            <Popup>
              <DropPopup drop={drop} position={position} />
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

function DropPopup({ drop, position }: { drop: DropRow; position: GeolocationPosition | null }) {
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function claim() {
    if (!position) {
      setMessage('Waiting for your location…')
      return
    }
    setBusy(true)
    try {
      await claimDrop(drop.id, position.coords.latitude, position.coords.longitude)
      setMessage(`Claimed! +${drop.points} for your team`)
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
