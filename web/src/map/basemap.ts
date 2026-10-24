import type { Map as MapLibreMap } from 'maplibre-gl'

/** OpenFreeMap's Positron: free vector tiles, no API key, already free of POI icons. */
export const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'

export const LABEL_FONT = ['Noto Sans Bold']

/** The only places named on the map besides streets; everything else stays quiet. */
export const LANDMARKS: Record<string, string> = {
  '0001000': 'Old Main',
  '0005000': 'HUB-Robeson',
  '0003000': 'Pattee Library',
  '0045000': 'Bryce Jordan Center',
  '0812000': 'Beaver Stadium',
  '0039000': 'Westgate',
  '0829000': 'Pegula Ice Arena',
}

const GREEN = '#dcebd5'

/** Softens Positron into a Life360-like canvas: our 3D buildings replace its flat ones, lawns go green. */
export function tuneBasemap(map: MapLibreMap) {
  const set = (layer: string, prop: Parameters<MapLibreMap['setPaintProperty']>[1], value: string) => {
    if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value)
  }
  if (map.getLayer('building')) map.setLayoutProperty('building', 'visibility', 'none')
  // Positron leaves grass unstyled; campus lawns are mostly that landcover class.
  if (!map.getLayer('lawns') && map.getSource('openmaptiles')) {
    map.addLayer(
      { id: 'lawns', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'grass'], paint: { 'fill-color': GREEN, 'fill-opacity': 0.85 } },
      'waterway',
    )
  }
  set('park', 'fill-color', GREEN)
  set('landcover_wood', 'fill-color', '#d3e6cb')
  set('landuse_residential', 'fill-color', '#f1f1ee')
  set('background', 'background-color', '#f5f5f2')
  set('water', 'fill-color', '#cfe3f2')
  for (const id of ['highway_minor', 'highway_path', 'highway_major_inner', 'highway_major_subtle']) set(id, 'line-color', '#e4e4e7')
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type === 'symbol' && layer.id !== 'landmarks') set(layer.id, 'text-color', '#9ca3af')
  }
}
