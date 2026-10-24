import type { FeatureCollection } from 'geojson'
import type { GeoJSON as LeafletGeoJSON, Path, PathOptions } from 'leaflet'
import { useEffect, useMemo, useRef } from 'react'
import { GeoJSON } from 'react-leaflet'
import type { Building } from '../lib/buildings'
import { DROP_ACCENT } from '../lib/campus'
import type { DropRow } from '../lib/database.types'

type Props = {
  buildings: Building[]
  /** Active drops; the buildings they sit at are highlighted. */
  drops: DropRow[]
  interactive?: boolean
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const NEUTRAL: PathOptions = { color: '#6b7280', weight: 1, fillColor: '#9ca3af', fillOpacity: 0.15 }
const PULSE_MS = 900

/** Campus buildings: neutral, except ones hosting an active drop, which glow in the accent color. */
function BuildingsLayer({ buildings, drops, interactive = true }: Props) {
  const layerRef = useRef<LeafletGeoJSON>(null)
  const collection = useMemo<FeatureCollection>(() => ({ type: 'FeatureCollection', features: buildings }), [buildings])
  const dropsByNum = useMemo(() => {
    const byNum = new Map<string, DropRow[]>()
    for (const d of drops) if (d.building_num) byNum.set(d.building_num, [...(byNum.get(d.building_num) ?? []), d])
    return byNum
  }, [drops])

  // GeoJSON's style/popup props are read once, so they go through a ref and restyle in place on change.
  const dropsRef = useRef(dropsByNum)
  const pulseRef = useRef(false)
  const style = (feature?: Building): PathOptions =>
    feature && dropsRef.current.has(feature.properties.num)
      ? { color: DROP_ACCENT, weight: pulseRef.current ? 4 : 2, fillColor: DROP_ACCENT, fillOpacity: pulseRef.current ? 0.65 : 0.4 }
      : NEUTRAL

  useEffect(() => {
    dropsRef.current = dropsByNum
    layerRef.current?.setStyle((f) => style(f as Building))
  })

  useEffect(() => {
    if (dropsByNum.size === 0) return
    const pulse = setInterval(() => {
      pulseRef.current = !pulseRef.current
      layerRef.current?.eachLayer((layer) => {
        const path = layer as Path & { feature?: Building }
        if (path.feature && dropsRef.current.has(path.feature.properties.num)) path.setStyle(style(path.feature))
      })
    }, PULSE_MS)
    return () => clearInterval(pulse)
  }, [dropsByNum.size])

  if (buildings.length === 0) return null

  return (
    <GeoJSON
      ref={layerRef}
      data={collection}
      style={(f) => style(f as Building)}
      interactive={interactive}
      onEachFeature={(feature: Building, layer) => {
        if (!interactive) return
        layer.bindPopup(() => {
          const here = dropsRef.current.get(feature.properties.num) ?? []
          const detail = here.length ? `Drop here: ${here.map((d) => escapeHtml(d.title)).join(', ')}` : 'No drop right now'
          return `<strong>${escapeHtml(feature.properties.name)}</strong><br>${detail}`
        })
      }}
    />
  )
}

export default BuildingsLayer
