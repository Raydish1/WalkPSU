import type { Feature, Polygon, Position } from 'geojson'
import type { Building } from '../lib/buildings'

const EARTH_RADIUS_M = 6371000
const rad = (deg: number) => (deg * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** A geodesic circle as a polygon, so a drop's claim radius renders at true size at any zoom or pitch. */
export function circlePolygon(lat: number, lng: number, radiusM: number, steps = 64): Polygon {
  const angular = radiusM / EARTH_RADIUS_M
  const φ1 = rad(lat)
  const λ1 = rad(lng)
  const ring: Position[] = []
  for (let i = 0; i <= steps; i++) {
    const bearing = (2 * Math.PI * i) / steps
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(angular) + Math.cos(φ1) * Math.sin(angular) * Math.cos(bearing))
    const λ2 = λ1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(φ1), Math.cos(angular) - Math.sin(φ1) * Math.sin(φ2))
    ring.push([deg(λ2), deg(φ2)])
  }
  return { type: 'Polygon', coordinates: [ring] }
}

function ringAreaM2(ring: Position[], lat0: number) {
  const mx = 111_195 * Math.cos(rad(lat0))
  const my = 111_195
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * mx * ring[i][1] * my - ring[i][0] * mx * ring[j][1] * my
  return Math.abs(sum) / 2
}

function footprintM2({ geometry, properties }: Building) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return polygons.reduce((total, [outer]) => total + ringAreaM2(outer, properties.lat), 0)
}

/** 10 m for a shed, rising to 15 m for the biggest halls: just enough variety to read as a skyline. */
export function buildingHeight(building: Building) {
  const t = (Math.log10(Math.max(footprintM2(building), 1)) - 2.3) / 2
  return 10 + 5 * Math.min(1, Math.max(0, t))
}

export type ExtrudedBuilding = Feature<Building['geometry'], Building['properties'] & { height: number }>

export function withHeights(buildings: Building[]): ExtrudedBuilding[] {
  return buildings.map((b) => ({ ...b, properties: { ...b.properties, height: buildingHeight(b) } }))
}
