import type { FeatureCollection } from 'geojson'
import type { GeoJSON as LeafletGeoJSON, PathOptions } from 'leaflet'
import { useEffect, useMemo, useRef } from 'react'
import { GeoJSON } from 'react-leaflet'
import type { Building } from '../lib/buildings'
import type { BuildingControlRow, TeamRow } from '../lib/database.types'

type Props = {
  buildings: Building[]
  control: BuildingControlRow[]
  teams: TeamRow[]
  interactive?: boolean
}

const NEUTRAL: PathOptions = { color: '#6b7280', weight: 1, fillColor: '#9ca3af', fillOpacity: 0.15 }

/** Campus buildings, filled with the color of the team that holds each one. */
function BuildingsLayer({ buildings, control, teams, interactive = true }: Props) {
  const layerRef = useRef<LeafletGeoJSON>(null)
  const collection = useMemo<FeatureCollection>(() => ({ type: 'FeatureCollection', features: buildings }), [buildings])
  const ownerByNum = useMemo(() => {
    const teamsById = new Map(teams.map((t) => [t.id, t]))
    return new Map(control.map((c) => [c.building_num, teamsById.get(c.team_id)]))
  }, [control, teams])

  // GeoJSON's style/popup props are read once, so they go through a ref and restyle in place on change.
  const ownerRef = useRef(ownerByNum)
  const style = (feature?: Building): PathOptions => {
    const owner = feature && ownerRef.current.get(feature.properties.num)
    return owner ? { color: owner.color, weight: 2, fillColor: owner.color, fillOpacity: 0.5 } : NEUTRAL
  }
  useEffect(() => {
    ownerRef.current = ownerByNum
    layerRef.current?.setStyle((f) => style(f as Building))
  })

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
          const owner = ownerRef.current.get(feature.properties.num)
          return `<strong>${feature.properties.name}</strong><br>${owner ? `Held by ${owner.name}` : 'Unclaimed'}`
        })
      }}
    />
  )
}

export default BuildingsLayer
