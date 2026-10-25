import { createContext, useContext } from 'react'

export type Discovery = {
  /** Every discoverable campus area (hex id), from web/src/map/hexgrid.ts. */
  areas: string[]
  discovered: ReadonlySet<string>
  /** The area discovered most recently this session, so the map can fade its fog out. */
  justDiscovered: string | null
  showFog: boolean
  setShowFog: (show: boolean) => void
}

export const DiscoveryContext = createContext<Discovery>({ areas: [], discovered: new Set(), justDiscovered: null, showFog: true, setShowFog: () => {} })

export function useDiscovery() {
  return useContext(DiscoveryContext)
}
