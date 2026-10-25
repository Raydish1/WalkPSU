import type { NeedleRainSettings } from '../lib/database.types'

/** Player line, in percent of the field height. Every phone uses this, so a dodge is the same event everywhere. */
export const PLAYER_Y = 78
/** Half the avatar's width, in fraction of the field. A needle whose x is inside this hits. */
export const HIT_HALF = 0.08

export type Needle = { id: number; spawn: number; x: number; speed: number; passAt: number }

/** FNV-1a. Same string, same 32-bit seed, on every device. */
export function hashSeed(seed: string) {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Mulberry32. Integer only, so phones don't drift the way Math.random() would. */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * The storm for one seed. Needles fall from the top at x positions from the seed, faster as the round
 * goes on. A needle counts as a dodge when it reaches the player line, so the schedule keeps that count
 * at or under floor(elapsed * max_dodges_per_second) — the server's cap.
 */
export function needleSchedule(seed: string, settings: Pick<NeedleRainSettings, 'game_seconds' | 'max_dodges_per_second'>): Needle[] {
  const rng = mulberry32(hashSeed(seed))
  const duration = settings.game_seconds
  const maxRate = settings.max_dodges_per_second
  const needles: Needle[] = []
  let t = 0.35
  while (t < duration && needles.length < duration * maxRate) {
    const u = Math.min(1, t / duration)
    // Peak spawn stays under the cap (0.18 → 0.70 of max_dodges_per_second). The last stretch is the fast one.
    const rate = maxRate * (0.18 + 0.52 * u)
    t += 1 / rate
    if (t >= duration) break
    const count = needles.length + 1
    let passAt = Math.max(t, count / maxRate)
    if (passAt * maxRate < count) passAt = count / maxRate + 1e-6
    if (passAt >= duration) break
    let speed = 30 + 130 * u * u
    let spawn = passAt - PLAYER_Y / speed
    if (spawn < 0) {
      spawn = 0
      speed = PLAYER_Y / passAt
    }
    needles.push({ id: needles.length, spawn, x: 0.1 + rng() * 0.8, speed, passAt })
  }
  return needles
}

/** True when every prefix of the storm is inside the server dodge cap, and the pattern only depends on the seed. */
export function scheduleRespectsCap(seed: string, settings: Pick<NeedleRainSettings, 'game_seconds' | 'max_dodges_per_second'>) {
  const needles = needleSchedule(seed, settings)
  if (needles.length === 0) return false
  if (JSON.stringify(needles) !== JSON.stringify(needleSchedule(seed, settings))) return false
  for (let i = 0; i < needles.length; i++) {
    const needle = needles[i]
    if (needle.passAt < needle.spawn || needle.passAt >= settings.game_seconds) return false
    if (i > 0 && needle.passAt < needles[i - 1].passAt) return false
    if (Math.floor(needle.passAt * settings.max_dodges_per_second + 1e-9) < i + 1) return false
  }
  const steps = 240
  for (let s = 1; s <= steps; s++) {
    const elapsed = (settings.game_seconds * s) / steps
    let count = 0
    for (const needle of needles) if (needle.passAt <= elapsed + 1e-9) count++
    if (count > Math.floor(elapsed * settings.max_dodges_per_second + 1e-9)) return false
  }
  return needles[needles.length - 1].speed > needles[0].speed
}

export type Runner = { x: number; dodges: number; eliminated: boolean; next: number }

/** Advances one runner through the shared storm. A hit freezes the dodge count; a miss is one dodge. */
export function stepRunner(needles: Needle[], elapsed: number, x: number, prev: Runner): Runner {
  if (prev.eliminated) return { ...prev, x }
  let dodges = prev.dodges
  let next = prev.next
  while (next < needles.length && needles[next].passAt <= elapsed) {
    const needle = needles[next]
    next += 1
    if (Math.abs(needle.x - x) <= HIT_HALF) return { x, dodges, eliminated: true, next }
    dodges += 1
  }
  return { x, dodges, eliminated: false, next }
}
