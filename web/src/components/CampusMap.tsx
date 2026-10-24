import { useEffect, type ReactNode } from 'react'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import type { Building } from '../lib/buildings'
import { CAMPUS_CENTER, OSM_TILES } from '../lib/campus'
import { campusBounds } from '../lib/geo'

function RestrictToCampus({ buildings }: { buildings: Building[] }) {
  const map = useMap()
  useEffect(() => {
    if (buildings.length === 0) return
    const bounds = campusBounds(buildings)
    map.setMaxBounds(bounds)
    // The furthest-out zoom at which the padded campus box still fills the screen.
    map.setMinZoom(map.getBoundsZoom(bounds, true))
  }, [map, buildings])
  return null
}

type Props = { buildings: Building[]; className: string; children: ReactNode }

/** OSM base map locked to University Park (plus ~1 mile), shared by the player and admin maps. */
function CampusMap({ buildings, className, children }: Props) {
  return (
    <MapContainer center={CAMPUS_CENTER} zoom={16} className={className} preferCanvas maxBoundsViscosity={1}>
      <TileLayer {...OSM_TILES} />
      <RestrictToCampus buildings={buildings} />
      {children}
    </MapContainer>
  )
}

export default CampusMap
