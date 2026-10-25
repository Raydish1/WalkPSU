import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { Marker, useMap } from 'react-map-gl/maplibre'

type Props = {
  id: string
  name: string
  color: string
  lng: number
  lat: number
  me?: boolean
  onTap: () => void
}

const GLIDE_MS = 600
const LAND_MS = 260
/** Farther than this on screen and the sprite just appears there; a cross-campus glide would look like a bug. */
const MAX_GLIDE_PX = 600
const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)'
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'

/** Stable small hash so a player keeps the same face and rhythm on every device. */
function hash(text: string) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** A player on the map: a little round face in their color that breathes, blinks, and hops to each new position. */
function PlayerSprite({ id, name, color, lng, lat, me = false, onTap }: Props) {
  const { current: map } = useMap()
  const glide = useRef<HTMLDivElement>(null)
  const hop = useRef<HTMLSpanElement>(null)
  const land = useRef<HTMLSpanElement>(null)
  const shadow = useRef<HTMLSpanElement>(null)
  const last = useRef<[number, number] | null>(null)

  const h = hash(id)
  const rhythm = {
    '--c': color,
    // Different periods and phases, so a crowd never breathes or blinks in unison.
    '--breathe': `${2200 + (h % 700)}ms`,
    '--breathe-delay': `-${h % 2000}ms`,
    '--blink': `${3200 + ((h >>> 4) % 2800)}ms`,
    '--blink-delay': `-${(h >>> 8) % 3000}ms`,
  } as CSSProperties

  // FLIP: the marker has already jumped to the new spot (react-map-gl moves it during render); start the sprite
  // where it was on screen and let it travel the rest. Runs before paint, so the jump is never visible.
  useLayoutEffect(() => {
    const from = last.current
    last.current = [lng, lat]
    const el = glide.current
    if (!from || !map || !el || (from[0] === lng && from[1] === lat) || reducedMotion()) return

    const a = map.project(from)
    const b = map.project([lng, lat])
    // Interrupted mid-glide: continue from where the sprite is drawn right now, not from the old target.
    const now = new DOMMatrixReadOnly(getComputedStyle(el).transform)
    const dx = a.x - b.x + now.m41
    const dy = a.y - b.y + now.m42
    el.getAnimations().forEach((anim) => anim.cancel())
    if (Math.hypot(dx, dy) < 1 || Math.hypot(dx, dy) > MAX_GLIDE_PX) return

    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: GLIDE_MS, easing: EASE_IN_OUT })
    hop.current?.animate(
      [{ transform: 'translateY(0)' }, { transform: 'translateY(-10px)', offset: 0.45 }, { transform: 'translateY(0)' }],
      { duration: GLIDE_MS, easing: 'ease-in-out' },
    )
    shadow.current?.animate(
      [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.6)', opacity: 0.5, offset: 0.45 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: GLIDE_MS, easing: 'ease-in-out' },
    )
    // Squash on landing: wide and short, then back to round.
    land.current?.animate(
      [{ transform: 'scale(1, 1)' }, { transform: 'scale(1.16, 0.84)', offset: 0.35 }, { transform: 'scale(1, 1)' }],
      { duration: LAND_MS, delay: GLIDE_MS - 40, easing: EASE_OUT },
    )
  }, [lng, lat, map])

  return (
    <Marker
      longitude={lng}
      latitude={lat}
      anchor="bottom"
      className="sprite-marker"
      style={{ zIndex: me ? 2 : 1 }}
      onClick={(e) => {
        // Keep the map's own click (which closes popups and sheets) from firing too.
        e.originalEvent.stopPropagation()
        onTap()
      }}
    >
      <div ref={glide} className={`sprite ${me ? 'is-me' : ''}`} style={rhythm}>
        <span ref={shadow} className="sprite-shadow" aria-hidden />
        <span ref={hop} className="sprite-hop">
          <span ref={land} className="sprite-land">
            <button type="button" className="sprite-body" aria-label={me ? `${name} (you)` : name}>
              <Face variant={h % FACES.length} />
            </button>
          </span>
        </span>
      </div>
    </Marker>
  )
}

const EYE = '#2a2533'

/** Mouths and eyes for the face variants; all share the same round body, blush, and highlight. */
const FACES: { eyes: ReactNode; mouth: ReactNode }[] = [
  // Dot eyes, small smile.
  {
    eyes: (
      <>
        <circle cx="14.5" cy="19" r="2.2" />
        <circle cx="25.5" cy="19" r="2.2" />
      </>
    ),
    mouth: <path d="M17.5 24.5q2.5 2.4 5 0" fill="none" stroke={EYE} strokeWidth="1.6" strokeLinecap="round" />,
  },
  // ^ ^ happy eyes, small smile.
  {
    eyes: (
      <g fill="none" stroke={EYE} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.3 20l2.2-2.6 2.2 2.6" />
        <path d="M23.3 20l2.2-2.6 2.2 2.6" />
      </g>
    ),
    mouth: <path d="M17.5 24.2q2.5 2.6 5 0" fill="none" stroke={EYE} strokeWidth="1.6" strokeLinecap="round" />,
  },
  // Dot eyes, open smile.
  {
    eyes: (
      <>
        <circle cx="14.5" cy="18.8" r="2.2" />
        <circle cx="25.5" cy="18.8" r="2.2" />
      </>
    ),
    mouth: (
      <>
        <path d="M16.8 23.4h6.4q-.4 4-3.2 4t-3.2-4z" fill={EYE} />
        <path d="M18.4 26.2q1.6-1.3 3.2 0q-.6.9-1.6.9t-1.6-.9z" fill="#ff7a8a" />
      </>
    ),
  },
  // Dot eyes, tiny ω mouth.
  {
    eyes: (
      <>
        <circle cx="14.5" cy="19" r="2.1" />
        <circle cx="25.5" cy="19" r="2.1" />
      </>
    ),
    mouth: <path d="M16.6 24.2q1.7 2.2 3.4 0q1.7 2.2 3.4 0" fill="none" stroke={EYE} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />,
  },
  // Shiny eyes, little round "o" mouth.
  {
    eyes: (
      <>
        <circle cx="14.5" cy="18.8" r="2.7" />
        <circle cx="25.5" cy="18.8" r="2.7" />
        <circle cx="15.4" cy="17.8" r="0.9" fill="#ffffff" />
        <circle cx="26.4" cy="17.8" r="0.9" fill="#ffffff" />
      </>
    ),
    mouth: <ellipse cx="20" cy="25.2" rx="1.6" ry="1.4" fill={EYE} />,
  },
]

function Face({ variant }: { variant: number }) {
  const { eyes, mouth } = FACES[variant]
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      {/* Drawn-in contact shadow instead of a CSS drop-shadow filter, which is costly on a breathing layer. */}
      <circle cx="20" cy="22.2" r="17" fill="rgba(30, 24, 40, 0.18)" />
      <circle className="sprite-ring" cx="20" cy="21" r="19" />
      <circle className="sprite-face" cx="20" cy="21" r="16" strokeWidth="1.4" />
      {/* Soft top-left highlight so the face reads as a little ball, not a flat disc. */}
      <ellipse cx="14" cy="13.5" rx="6" ry="3.6" fill="#ffffff" opacity="0.28" transform="rotate(-20 14 13.5)" />
      <ellipse cx="10.8" cy="24.4" rx="3.2" ry="2" fill="#ff8fab" opacity="0.6" />
      <ellipse cx="29.2" cy="24.4" rx="3.2" ry="2" fill="#ff8fab" opacity="0.6" />
      <g className="sprite-eyes" fill={EYE}>
        {eyes}
      </g>
      {mouth}
    </svg>
  )
}

export default PlayerSprite
