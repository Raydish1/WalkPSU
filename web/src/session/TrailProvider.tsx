import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { distanceM } from '../lib/geo'
import { usePresence, type LivePlayer } from './presence'
import { useReadySession } from './session'
import { TrailContext, type Tail, type TrailPoint } from './trail'

const MIN_STEP_M = 3 // GPS jitter while standing still
const MAX_ACCURACY_M = 25 // fixes vaguer than this are skipped
const MAX_SPEED_MPS = 9 // faster than a sprint: a GPS jump, not a walk
const MAX_GAP_M = 150 // farther than this from the last point starts a new segment
const MAX_POINTS = 5000 // a long day of walking at one point every few meters
const TAIL_MS = 2 * 60_000
const SAVE_DELAY_MS = 3000

type Stored = { day: string; segments: TrailPoint[][] }
type TailState = Tail & { times: number[] }

const today = () => new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in local time
const storageKey = (playerId: string) => `walkpsu:trail:${playerId}`

function load(playerId: string): TrailPoint[][] {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(playerId)) ?? 'null') as Stored | null
    return stored?.day === today() ? stored.segments : []
  } catch {
    return []
  }
}

function save(playerId: string, segments: TrailPoint[][]) {
  try {
    localStorage.setItem(storageKey(playerId), JSON.stringify({ day: today(), segments } satisfies Stored))
  } catch {
    // Private mode or full storage: the trail still works until a refresh.
  }
}

const step = ([lng1, lat1]: TrailPoint, [lng2, lat2]: TrailPoint) => distanceM(lat1, lng1, lat2, lng2)

function lengthOf(segments: TrailPoint[][]) {
  let total = 0
  for (const segment of segments) for (let i = 1; i < segment.length; i++) total += step(segment[i - 1], segment[i])
  return total
}

/** Keeps the newest MAX_POINTS, dropping whole old segments first. */
function trim(segments: TrailPoint[][]) {
  let count = segments.reduce((n, s) => n + s.length, 0)
  if (count <= MAX_POINTS) return segments
  const out = [...segments]
  while (count > MAX_POINTS && out.length > 1) count -= out.shift()!.length
  if (count > MAX_POINTS) out[0] = out[0].slice(count - MAX_POINTS)
  return out
}

/** Drops tail points older than TAIL_MS; returns the same object when nothing aged out. */
function age(tail: TailState, now: number): TailState {
  const first = tail.times.findIndex((t) => now - t <= TAIL_MS)
  if (first === 0) return tail
  const from = first === -1 ? tail.times.length : first
  return { ...tail, points: tail.points.slice(from), times: tail.times.slice(from) }
}

/** Records my trail from the one GPS watcher (PresenceProvider) and others' short tails from Presence. */
export function TrailProvider({ children }: { children: ReactNode }) {
  const { player } = useReadySession()
  const { subscribe } = usePresence()
  const [segments, setSegments] = useState(() => load(player.id))
  const [tails, setTails] = useState<TailState[]>([])
  // The source of truth between renders, so two fixes before a re-render never lose a point.
  const trail = useRef({ segments, day: today(), last: null as { point: TrailPoint; at: number } | null })

  const commit = (next: TrailPoint[][]) => {
    trail.current.segments = next
    setSegments(next)
  }

  // Save at most every few seconds while walking (a steady stream of fixes must not postpone it forever),
  // and right away when the page is hidden or closed.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (saveTimer.current) return
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      save(player.id, trail.current.segments)
    }, SAVE_DELAY_MS)
  }, [segments, player.id])
  useEffect(() => {
    const flush = () => save(player.id, trail.current.segments)
    const onHidden = () => document.visibilityState === 'hidden' && flush()
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', flush)
    }
  }, [player.id])

  useEffect(() => {
    const onPosition = (fix: GeolocationPosition) => {
      const { latitude, longitude, accuracy } = fix.coords
      if (!(accuracy <= MAX_ACCURACY_M)) return
      const state = trail.current
      // Past midnight, yesterday's trail is done.
      if (state.day !== today()) Object.assign(state, { day: today(), segments: [], last: null })
      const point: TrailPoint = [longitude, latitude]
      const from = state.last?.point ?? state.segments.at(-1)?.at(-1) ?? null
      const meters = from ? step(from, point) : Infinity
      if (meters < MIN_STEP_M) return
      const seconds = state.last ? (fix.timestamp - state.last.at) / 1000 : Infinity
      const jumped = !from || meters > MAX_GAP_M || (seconds > 0 && meters / seconds > MAX_SPEED_MPS)
      state.last = { point, at: fix.timestamp }
      const segs = state.segments
      commit(trim(jumped ? [...segs, [point]] : [...segs.slice(0, -1), [...segs[segs.length - 1], point]]))
    }

    const onOthers = (others: LivePlayer[]) => {
      const now = Date.now()
      setTails((current) => {
        const byId = new Map(current.map((t) => [t.playerId, age(t, now)]))
        return others.map(({ playerId, color, lat, lng }) => {
          const tail = byId.get(playerId) ?? { playerId, color, points: [], times: [] }
          const point: TrailPoint = [lng, lat]
          const end = tail.points.at(-1)
          if (end && step(end, point) < MIN_STEP_M) return { ...tail, color }
          return { playerId, color, points: [...tail.points, point], times: [...tail.times, now] }
        })
      })
    }

    return subscribe({ position: onPosition, others: onOthers })
  }, [subscribe])

  // Tails also fade out when nobody moves, not only on the next Presence sync.
  useEffect(() => {
    const prune = setInterval(() => {
      const now = Date.now()
      setTails((current) => {
        const next = current.map((t) => age(t, now))
        return next.every((t, i) => t === current[i]) ? current : next
      })
    }, 10_000)
    return () => clearInterval(prune)
  }, [])

  const value = useMemo(
    () => ({
      segments,
      distanceM: lengthOf(segments),
      tails: tails.map(({ playerId, color, points }) => ({ playerId, color, points })),
      clearTrail: () => {
        trail.current.last = null
        commit([])
      },
      restoreTrail: (restored: TrailPoint[][]) => commit(restored),
    }),
    [segments, tails],
  )
  return <TrailContext.Provider value={value}>{children}</TrailContext.Provider>
}
