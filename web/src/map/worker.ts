import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

// MapLibre 6 no longer inlines its worker; without this, GeoJSON sources never load and the map stays blank.
setWorkerUrl(workerUrl)
