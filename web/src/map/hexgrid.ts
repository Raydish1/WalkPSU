import type { FeatureCollection, Polygon } from 'geojson'
import type { Building } from '../lib/buildings'
import { CAMPUS_CENTER } from '../lib/campus'
import { distanceM } from '../lib/geo'

// Fog-of-war areas: pointy-top hexes with 120 m edges on a flat projection around Old Main, keyed by axial
// coordinates "q:r". Ids depend only on these constants, so stored discoveries (discovered_areas) never shift.
const EDGE_M = 120
const [ORIGIN_LAT, ORIGIN_LNG] = CAMPUS_CENTER
const M_PER_DEG_LAT = 111_195
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((ORIGIN_LAT * Math.PI) / 180)
const NEIGHBORS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
]

/** The area a point falls in (it may be outside the campus set; check against `campusAreas`). */
export function hexAt(lat: number, lng: number) {
  const x = (lng - ORIGIN_LNG) * M_PER_DEG_LNG
  const y = (lat - ORIGIN_LAT) * M_PER_DEG_LAT
  const q = ((Math.sqrt(3) / 3) * x - y / 3) / EDGE_M
  const r = ((2 / 3) * y) / EDGE_M
  // Cube rounding: round all three coordinates, then fix the one that moved most.
  let rq = Math.round(q)
  let rr = Math.round(r)
  const rs = Math.round(-q - r)
  const dq = Math.abs(rq - q)
  const dr = Math.abs(rr - r)
  const ds = Math.abs(rs + q + r)
  if (dq > dr && dq > ds) rq = -rr - rs
  else if (dr > ds) rr = -rq - rs
  return `${rq}:${rr}`
}

/** The hex's six corners as a closed GeoJSON ring. */
function hexRing(id: string) {
  const [q, r] = id.split(':').map(Number)
  const cx = EDGE_M * Math.sqrt(3) * (q + r / 2)
  const cy = EDGE_M * 1.5 * r
  const ring = Array.from({ length: 7 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * (i % 6) - 30)
    return [ORIGIN_LNG + (cx + EDGE_M * Math.cos(angle)) / M_PER_DEG_LNG, ORIGIN_LAT + (cy + EDGE_M * Math.sin(angle)) / M_PER_DEG_LAT]
  })
  return ring
}

const CORE_RADIUS_M = 2500 // the same core campusBounds uses, without its outer padding
const MIN_BUILDINGS = 2

/**
 * Central campus as discoverable areas: hexes holding at least two core buildings, plus any hex mostly surrounded
 * by those (lawns and quads between buildings), so the fog is one continuous sheet. 150 areas for the current
 * buildings.geojson.
 */
export function campusAreas(buildings: Building[]): string[] {
  if (buildings.length === 0) return []
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]
  const center = { lat: median(buildings.map((b) => b.properties.lat)), lng: median(buildings.map((b) => b.properties.lng)) }
  const counts = new Map<string, number>()
  for (const { properties: p } of buildings) {
    if (distanceM(center.lat, center.lng, p.lat, p.lng) > CORE_RADIUS_M) continue
    const id = hexAt(p.lat, p.lng)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const areas = new Set([...counts].filter(([, n]) => n >= MIN_BUILDINGS).map(([id]) => id))
  const neighbors = (id: string) => {
    const [q, r] = id.split(':').map(Number)
    return NEIGHBORS.map(([dq, dr]) => `${q + dq}:${r + dr}`)
  }
  for (let grew = true; grew; ) {
    grew = false
    for (const id of new Set([...areas].flatMap(neighbors))) {
      if (!areas.has(id) && neighbors(id).filter((n) => areas.has(n)).length >= 4) {
        areas.add(id)
        grew = true
      }
    }
  }
  return [...areas].sort()
}

export function hexFeatures(ids: Iterable<string>): FeatureCollection<Polygon> {
  return {
    type: 'FeatureCollection',
    features: [...ids].map((id) => ({ type: 'Feature', properties: { id }, geometry: { type: 'Polygon', coordinates: [hexRing(id)] } })),
  }
}
