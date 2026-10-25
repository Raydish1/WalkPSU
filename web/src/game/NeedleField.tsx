import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { PLAYER_Y, needleSchedule, stepRunner, type Runner } from './needleRain'
import type { NeedleSample } from './useNeedleBroadcast'
import type { useSteer } from './useSteer'

export type NeedleActor = { id: string; name: string; color: string; x: number; dodges: number; eliminated: boolean }

type Props = {
  seed: string
  gameSeconds: number
  maxRate: number
  originMs: number
  offsetRef: { current: number }
  /** The phone's own runner. The projector omits this and draws `actorsRef` instead. */
  steer?: ReturnType<typeof useSteer> | null
  self?: { name: string; color: string } | null
  actorsRef?: { current: NeedleActor[] }
  big?: boolean
  onSample?: (sample: NeedleSample) => void
}

const SAFE_COLOR = /^#[0-9a-f]{6}$/i

function face(color: string, name: string, big: boolean) {
  const el = document.createElement('div')
  el.className = 'needle-actor'
  const disc = document.createElement('span')
  disc.className = 'needle-face'
  if (SAFE_COLOR.test(color)) disc.style.background = color
  disc.textContent = [...name.trim()][0]?.toUpperCase() ?? '?'
  const label = document.createElement('span')
  label.className = 'needle-name'
  label.textContent = name
  const count = document.createElement('span')
  count.className = 'needle-count'
  el.append(disc, label, count)
  if (big) el.dataset.big = '1'
  return el
}

/**
 * One storm, drawn the same on every phone from the seed and the server start time. No Math.random().
 * Needles keep moving under reduced motion: the motion is the game, not decoration.
 */
function NeedleField({ seed, gameSeconds, maxRate, originMs, offsetRef, steer, self, actorsRef, big, onSample }: Props) {
  const fieldRef = useRef<HTMLDivElement>(null)
  const countRef = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<HTMLSpanElement>(null)
  const outRef = useRef<HTMLParagraphElement>(null)
  const onSampleRef = useRef(onSample)
  useEffect(() => {
    onSampleRef.current = onSample
  })
  const needles = useMemo(() => needleSchedule(seed, { game_seconds: gameSeconds, max_dodges_per_second: maxRate }), [seed, gameSeconds, maxRate])

  useEffect(() => {
    const field = fieldRef.current
    if (!field) return
    const needleEls = needles.map(() => {
      const el = document.createElement('span')
      el.className = 'needle'
      el.hidden = true
      field.appendChild(el)
      return el
    })
    const selfEl = steer && self ? face(self.color, self.name, !!big) : null
    if (selfEl) field.appendChild(selfEl)
    const actors = new Map<string, HTMLDivElement>()
    let sim: Runner = { x: 0.5, dodges: 0, eliminated: false, next: 0 }
    let last = performance.now()
    let raf = 0

    const frame = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      const elapsed = (Date.now() + offsetRef.current - originMs) / 1000
      if (steer && !sim.eliminated) {
        const keys = steer.keysRef.current
        const keyAxis = (keys.left ? -1 : 0) + (keys.right ? 1 : 0)
        const stick = steer.stickRef.current
        let axis = 0
        if (keyAxis !== 0 || stick !== 0) axis = Math.max(-1, Math.min(1, keyAxis + stick))
        else if (steer.gammaRef.current !== null) axis = Math.max(-1, Math.min(1, steer.gammaRef.current / 18))
        sim.x = Math.max(0.08, Math.min(0.92, sim.x + axis * 0.95 * dt))
      }
      if (steer) sim = stepRunner(needles, elapsed, sim.x, sim)

      for (let i = 0; i < needles.length; i++) {
        const needle = needles[i]
        const y = (elapsed - needle.spawn) * needle.speed
        const el = needleEls[i]
        const visible = y > -16 && y < 110
        el.hidden = !visible
        if (visible) {
          el.style.left = `${needle.x * 100}%`
          el.style.top = `${y - 14}%`
        }
      }

      if (selfEl) {
        selfEl.style.left = `${sim.x * 100}%`
        selfEl.classList.toggle('is-out', sim.eliminated)
        const count = selfEl.querySelector('.needle-count')
        if (count) count.textContent = String(sim.dodges)
      }

      if (actorsRef) {
        const wanted = actorsRef.current
        const ids = new Set(wanted.map((actor) => actor.id))
        for (const [id, el] of actors) {
          if (!ids.has(id)) {
            el.remove()
            actors.delete(id)
          }
        }
        for (const actor of wanted) {
          let el = actors.get(actor.id)
          if (!el) {
            el = face(actor.color, actor.name, true)
            field.appendChild(el)
            actors.set(actor.id, el)
          }
          el.style.left = `${actor.x * 100}%`
          el.classList.toggle('is-out', actor.eliminated)
          const count = el.querySelector('.needle-count')
          if (count) count.textContent = String(actor.dodges)
        }
      }

      if (countRef.current && steer) countRef.current.textContent = String(sim.dodges)
      if (timerRef.current) timerRef.current.textContent = `${Math.max(0, Math.ceil(gameSeconds - elapsed))}s`
      if (outRef.current) outRef.current.hidden = !sim.eliminated
      onSampleRef.current?.({ x: sim.x, count: sim.dodges, eliminated: sim.eliminated })
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      for (const el of needleEls) el.remove()
      selfEl?.remove()
      for (const el of actors.values()) el.remove()
    }
  }, [needles, originMs, gameSeconds, steer, self, actorsRef, big, offsetRef])

  return (
    <div className="needle-play">
      <div className="needle-top">
        <span ref={countRef} className="needle-hud">
          0
        </span>
        <span ref={timerRef} className="needle-hud" role="timer">
          {gameSeconds}s
        </span>
      </div>
      <div ref={fieldRef} className="needle-field" style={{ '--player-y': `${PLAYER_Y}%` } as CSSProperties} />
      <p ref={outRef} className="needle-out" hidden>
        You’re out
      </p>
    </div>
  )
}

export default NeedleField
