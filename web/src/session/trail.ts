import { createContext, useContext } from 'react'

/** [lng, lat], GeoJSON order. */
export type TrailPoint = [number, number]

/** Another player's recent path, from Presence updates seen this session. Memory only. */
export type Tail = { playerId: string; color: string; points: TrailPoint[] }

export type Trails = {
  /** Today's walk, split wherever GPS jumped (so no line is drawn across a jump). Never leaves this device. */
  segments: TrailPoint[][]
  distanceM: number
  clearTrail: () => void
  /** Puts back a trail just cleared (the "Undo" on the toast). */
  restoreTrail: (segments: TrailPoint[][]) => void
  tails: Tail[]
}

export const TrailContext = createContext<Trails>({ segments: [], distanceM: 0, clearTrail: () => {}, restoreTrail: () => {}, tails: [] })

export function useTrails() {
  return useContext(TrailContext)
}
