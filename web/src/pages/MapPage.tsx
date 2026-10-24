import { MapContainer, TileLayer } from 'react-leaflet'
import { CAMPUS_CENTER, OSM_TILES } from '../lib/campus'

function MapPage() {
  return (
    <MapContainer center={CAMPUS_CENTER} zoom={16} className="map">
      <TileLayer {...OSM_TILES} />
    </MapContainer>
  )
}

export default MapPage
