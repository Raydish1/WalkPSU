// Regenerates public/data/buildings.geojson from PASDA's University Park buildings layer.
// Run from web/: npm run fetch-buildings
import { mkdir, writeFile } from 'node:fs/promises'
import mapshaper from 'mapshaper'

const LAYER = 'https://mapservices.pasda.psu.edu/server/rest/services/pasda/PSU_Campus/MapServer/1/query'
const PAGE_SIZE = 1000
const OUT = 'public/data/buildings.geojson'

async function fetchPage(offset) {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: 'BLDG_NUM,BLDG_NAME',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    orderByFields: 'OBJECTID',
  })
  const res = await fetch(`${LAYER}?${params}`)
  if (!res.ok) throw new Error(`PASDA returned ${res.status}`)
  return res.json()
}

const features = []
for (let offset = 0; ; offset += PAGE_SIZE) {
  const page = await fetchPage(offset)
  features.push(...page.features)
  console.log(`fetched ${features.length}`)
  if (page.features.length < PAGE_SIZE && !page.properties?.exceededTransferLimit) break
}

// ArcGIS writes missing attributes as the string "<Null>".
const clean = (value) => (value == null || String(value).trim() === '<Null>' ? '' : String(value).trim())

const raw = { type: 'FeatureCollection', features: features.filter((f) => f.geometry && clean(f.properties.BLDG_NUM)) }

// Some buildings are split into several polygons; dissolve by number so each building is one feature.
const { 'buildings.geojson': simplified } = await mapshaper.applyCommands(
  [
    '-i raw.geojson',
    '-dissolve2 BLDG_NUM copy-fields=BLDG_NAME',
    '-simplify 15% keep-shapes',
    '-each "lat=this.innerY, lng=this.innerX"',
    '-o buildings.geojson precision=0.000001',
  ].join(' '),
  { 'raw.geojson': raw },
)

const buildings = JSON.parse(simplified)
  .features.filter((f) => f.geometry && f.properties.lat != null)
  .map(({ geometry, properties: p }) => {
    const num = clean(p.BLDG_NUM)
    const name = clean(p.BLDG_NAME) || `Building ${num}`
    return { type: 'Feature', properties: { num, name, lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }, geometry }
  })
  .sort((a, b) => a.properties.name.localeCompare(b.properties.name))

const out = JSON.stringify({ type: 'FeatureCollection', features: buildings })
await mkdir('public/data', { recursive: true })
await writeFile(OUT, out)
console.log(`wrote ${OUT}: ${buildings.length} buildings, ${(out.length / 1024).toFixed(0)} KB`)
