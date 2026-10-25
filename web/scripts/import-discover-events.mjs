// Snapshots upcoming public events from Penn State Discover (Campus Labs Engage) and matches each to a campus building.
// Run from web/: npm run import-events   (writes scripts/data/discover-events.json; seed with npm run seed-events)
// Keeps only public event facts: no descriptions, organizer contacts, or attendee data.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { findBuildingAt } from '../src/lib/buildings.ts'
import { BUILDING_NICKNAMES, CAMPUS_CENTER } from '../src/lib/campus.ts'
import { distanceM } from '../src/lib/geo.ts'

const API = 'https://discover.psu.edu/api/discovery/event/search'
const PAGE_SIZE = 100
const MAX_PAGES = 5
const OUT = 'scripts/data/discover-events.json'

async function fetchPage(skip) {
  const params = new URLSearchParams({
    endsAfter: new Date().toISOString(),
    orderByField: 'endsOn',
    orderByDirection: 'ascending',
    status: 'Approved',
    take: String(PAGE_SIZE),
    skip: String(skip),
    query: '',
  })
  const res = await fetch(`${API}?${params}`, { headers: { accept: 'application/json', 'user-agent': 'WalkPSU HackPSU demo importer' } })
  if (!res.ok) throw new Error(`Discover returned ${res.status}`)
  return res.json()
}

const raw = []
for (let page = 0; page < MAX_PAGES; page++) {
  const { value, '@odata.count': total } = await fetchPage(page * PAGE_SIZE)
  raw.push(...value)
  console.log(`fetched ${raw.length} of ${total}`)
  if (value.length < PAGE_SIZE || raw.length >= total) break
  await new Promise((r) => setTimeout(r, 1000))
}

const buildings = JSON.parse(await readFile('public/data/buildings.geojson', 'utf8')).features

// Names to look for in free-text locations, e.g. "HUB 233" or "Boucke 219". An alias that fits two buildings is dropped.
// A short alias ("Boucke" for "Boucke Building") counts only before a room number or at the end, so "Beaver Stadium"
// doesn't land in Beaver Hall and "Flex Theater" doesn't land in the Theater Building.
const normalize = (s) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
const aliases = new Map()
const addAlias = (alias, building, short = false) => {
  const key = normalize(alias)
  if (key.trim().length < 3) return
  const prev = aliases.get(key)
  aliases.set(key, prev && prev.building !== building ? null : { building, short: short && (prev?.short ?? true) })
}
for (const b of buildings) {
  const { name, num } = b.properties
  const bare = name.replace(/\s*\(.*?\)\s*/g, ' ').trim()
  for (const n of new Set([name, bare])) {
    addAlias(n, b)
    const short = n.replace(/\s+(Building|Bldg|Hall|Center|Laboratory)$/i, '')
    if (short !== n && short.length >= 5) addAlias(short, b, true)
  }
  // 'HUB-Robeson Center' → HUB and Robeson Center; 'Bryce Jordan Center BJC' → BJC and Bryce Jordan Center.
  const words = BUILDING_NICKNAMES[num]?.split(/[^A-Za-z]+/).filter(Boolean) ?? []
  for (const acronym of words.filter((w) => w === w.toUpperCase())) addAlias(acronym, b)
  const rest = words.filter((w) => w !== w.toUpperCase())
  if (rest.length >= 2) addAlias(rest.join(' '), b)
}
for (const [key, a] of aliases) if (!a) aliases.delete(key)

function matchText(location) {
  const text = normalize(location)
  const hits = []
  for (const [alias, { building, short }] of aliases) {
    const at = text.indexOf(alias)
    if (at < 0) continue
    if (short && !/^(\d\S*\s|$)/.test(text.slice(at + alias.length))) continue
    hits.push({ at, length: alias.length, building })
  }
  // The building named first is the venue ("HUB 132 - Flex Theater"); among names at the same spot, the longest wins.
  hits.sort((a, b) => a.at - b.at || b.length - a.length)
  return hits[0]?.building
}

// Penn State Discover lists events from every campus; anything plotted this far from Old Main isn't at University Park.
const far = (e) => e.lat !== null && distanceM(e.lat, e.lng, CAMPUS_CENTER[0], CAMPUS_CENTER[1]) > 4000

/** The building a player should walk to. A building named in the text beats a pin, which organizers drop loosely. */
function match(e) {
  if (far(e)) return null
  const named = e.location && matchText(e.location)
  if (named) return { building: named, by: 'location text' }
  const pinned = e.lat !== null && findBuildingAt(buildings, e.lat, e.lng)
  return pinned ? { building: pinned, by: 'coordinates' } : null
}

const coord = (v) => (v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
const events = raw
  .filter((e) => e.visibility === 'Public' && e.status === 'Approved')
  .map((e) => {
    const event = {
      id: e.id,
      title: e.name.trim(),
      organization: e.organizationName?.trim() || null,
      theme: e.theme ?? null,
      categories: e.categoryNames ?? [],
      starts_at: e.startsOn,
      ends_at: e.endsOn,
      location: e.location?.trim() || null,
      lat: coord(e.latitude),
      lng: coord(e.longitude),
    }
    const m = match(event)
    const { num, name, lat, lng } = m?.building.properties ?? {}
    return { ...event, building: m ? { num, name, lat, lng, matched_by: m.by } : null }
  })

await mkdir('scripts/data', { recursive: true })
await writeFile(OUT, JSON.stringify({ source: 'https://discover.psu.edu/events', fetched_at: new Date().toISOString(), events }, null, 2) + '\n')

const matched = events.filter((e) => e.building)
const by = (how) => matched.filter((e) => e.building.matched_by === how).length
console.log(`wrote ${OUT}: ${events.length} events, ${matched.length} matched (${by('coordinates')} by coordinates, ${by('location text')} by location text), ${events.length - matched.length} skipped`)
