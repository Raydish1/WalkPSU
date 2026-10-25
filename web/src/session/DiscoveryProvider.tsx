import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { discoverArea, getDiscoveredAreas } from '../lib/api'
import { useBuildings } from '../lib/hooks'
import { campusAreas, hexAt } from '../map/hexgrid'
import { DiscoveryContext } from './discovery'
import { usePresence } from './presence'

/** Only a confident fix discovers an area, so drifting GPS indoors doesn't uncover the hex next door. */
const MAX_ACCURACY_M = 20
const FOG_KEY = 'walkpsu:show-fog'

function readShowFog() {
  try {
    return localStorage.getItem(FOG_KEY) !== 'off'
  } catch {
    return true
  }
}

/** Fog-of-war: loads my discovered areas and records new ones from the one GPS watcher. */
export function DiscoveryProvider({ children }: { children: ReactNode }) {
  const { subscribe } = usePresence()
  const buildings = useBuildings()
  const areas = useMemo(() => campusAreas(buildings), [buildings])
  const [discovered, setDiscovered] = useState<ReadonlySet<string>>(new Set())
  const [justDiscovered, setJustDiscovered] = useState<string | null>(null)
  const [showFog, setShowFogState] = useState(readShowFog)
  const known = useRef({ areas: new Set<string>(), discovered: new Set<string>(), pending: new Set<string>(), lastFix: null as GeolocationPosition | null })
  const consider = useRef<(fix: GeolocationPosition) => void>(() => {})

  useEffect(() => {
    getDiscoveredAreas().then((ids) => {
      for (const id of ids) known.current.discovered.add(id)
      setDiscovered(new Set(known.current.discovered))
    }, console.error)
  }, [])

  useEffect(() => {
    const onPosition = (fix: GeolocationPosition) => {
      known.current.lastFix = fix
      const { latitude, longitude, accuracy } = fix.coords
      if (!(accuracy <= MAX_ACCURACY_M)) return
      const id = hexAt(latitude, longitude)
      const k = known.current
      if (!k.areas.has(id) || k.discovered.has(id) || k.pending.has(id)) return
      k.pending.add(id)
      discoverArea(id)
        .then((isNew) => {
          k.discovered.add(id)
          setDiscovered(new Set(k.discovered))
          // Only the server knows if it's really new (another device may have found it first).
          if (isNew) {
            setJustDiscovered(id)
            navigator.vibrate?.(20)
            toast('New area discovered!', { id: `area-${id}`, description: `${k.discovered.size} of ${k.areas.size} campus areas explored` })
          }
        }, console.error) // offline: it stays undiscovered locally and is retried on the next fix
        .finally(() => k.pending.delete(id))
    }
    consider.current = onPosition
    return subscribe({ position: onPosition })
  }, [subscribe])

  // A player standing still gets one fix, often before the building data (and so the areas) has loaded.
  // Check that fix again once the areas are known.
  useEffect(() => {
    known.current.areas = new Set(areas)
    if (known.current.lastFix) consider.current(known.current.lastFix)
  }, [areas])

  const value = useMemo(
    () => ({
      areas,
      discovered,
      justDiscovered,
      showFog,
      setShowFog: (show: boolean) => {
        try {
          localStorage.setItem(FOG_KEY, show ? 'on' : 'off')
        } catch {
          // The toggle still works for this session.
        }
        setShowFogState(show)
      },
    }),
    [areas, discovered, justDiscovered, showFog],
  )
  return <DiscoveryContext.Provider value={value}>{children}</DiscoveryContext.Provider>
}
