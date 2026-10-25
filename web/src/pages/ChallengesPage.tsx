import { useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router'
import { StarIcon } from '../components/icons'
import { DROP_TYPES } from '../lib/campus'
import {
  EVENT_CATEGORIES,
  categoryLabel,
  matchesEventQuery,
  resolveCategory,
  type EventCategoryId,
} from '../lib/events'
import { difficultyForPoints } from '../lib/progress'
import { useDrops } from '../lib/hooks'
import { distanceM } from '../lib/geo'
import type { DropRow } from '../lib/database.types'
import { usePresence } from '../session/presence'
import { CHEM_PRACTICE_ID } from './ChemPage'
import { MATH_PRACTICE_ID } from './MathPage'

type ListedEvent = {
  key: string
  drop: DropRow
  href: string
  cta: string
  blurb: string
  practice?: boolean
}

function challengeHref(type: keyof typeof DROP_TYPES, id: string) {
  if (type === 'minigame') return `/game/${id}`
  if (type === 'math') return `/math/${id}`
  if (type === 'chemistry') return `/chem/${id}`
  return '/'
}

function stubDrop(partial: Pick<DropRow, 'id' | 'title' | 'type'> & { category: string; points?: number }): DropRow {
  return {
    lat: 0,
    lng: 0,
    points: partial.points ?? 20,
    status: 'active',
    hint_photo_url: null,
    building_num: null,
    created_by: null,
    created_at: '',
    expires_at: null,
    ...partial,
  }
}

/** Always searchable — practice quizzes + sample themed events for filter demos. */
const CURATED_EVENTS: ListedEvent[] = [
  {
    key: 'practice-math',
    practice: true,
    href: `/math/${MATH_PRACTICE_ID}`,
    cta: 'Start Challenge',
    blurb: '3 problems · √ − ÷ fractions · no GPS needed',
    drop: stubDrop({ id: MATH_PRACTICE_ID, title: 'Old Main Mental Math', type: 'math', category: 'academics' }),
  },
  {
    key: 'practice-chem',
    practice: true,
    href: `/chem/${CHEM_PRACTICE_ID}`,
    cta: 'Start Challenge',
    blurb: '3 problems · elements + easy formulas (H₂O) · no GPS needed',
    drop: stubDrop({ id: CHEM_PRACTICE_ID, title: 'Osmond Lab Chemistry', type: 'chemistry', category: 'academics' }),
  },
  {
    key: 'spotlight-bball',
    practice: true,
    href: '/',
    cta: 'View on map',
    blurb: 'Sports spotlight · live BJC drops show up here too',
    drop: stubDrop({
      id: 'spotlight-bball',
      title: 'Basketball Night at the BJC',
      type: 'checkin',
      category: 'sports',
      points: 25,
    }),
  },
  {
    key: 'spotlight-culture',
    practice: true,
    href: '/',
    cta: 'View on map',
    blurb: 'Culture spotlight · arts & festival check-ins',
    drop: stubDrop({
      id: 'spotlight-culture',
      title: 'Culture Fest at the HUB',
      type: 'photo_hunt',
      category: 'culture',
      points: 20,
    }),
  },
]

function ChallengesPage() {
  const { data: drops, error } = useDrops()
  const { position } = usePresence()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<EventCategoryId | 'all'>('all')

  const catalog = useMemo(() => {
    const live: ListedEvent[] = drops.map((drop) => ({
      key: drop.id,
      drop,
      href: challengeHref(drop.type, drop.id),
      cta:
        drop.type === 'minigame' || drop.type === 'math' || drop.type === 'chemistry'
          ? 'Start Challenge'
          : 'View on map',
      blurb: [
        `+${drop.points} pts`,
        drop.type === 'math' ? '√ − ÷ fractions' : null,
        drop.type === 'chemistry' ? 'elements + formulas' : null,
      ]
        .filter(Boolean)
        .join(' · '),
    }))
    return [...CURATED_EVENTS, ...live]
  }, [drops])

  const filtered = useMemo(
    () => catalog.filter((item) => matchesEventQuery(item.drop, query, category)),
    [catalog, query, category],
  )

  return (
    <section className="page stack">
      <header>
        <p className="muted footnote" style={{ margin: 0, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--accent)' }}>
          Territory quests
        </p>
        <h1>Challenges</h1>
        <p className="muted">Search campus events — basketball, culture, academics, and more.</p>
      </header>

      <label className="field">
        <span className="visually-hidden">Search events</span>
        <input
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search basketball, culture, math…"
          enterKeyHint="search"
          autoComplete="off"
        />
      </label>

      <div className="filter-chips" role="toolbar" aria-label="Filter by event theme">
        <button
          type="button"
          className="filter-chip"
          data-on={category === 'all' || undefined}
          onClick={() => setCategory('all')}
        >
          All
        </button>
        {(Object.keys(EVENT_CATEGORIES) as EventCategoryId[]).map((id) => (
          <button
            key={id}
            type="button"
            className="filter-chip"
            data-on={category === id || undefined}
            style={{ '--chip': EVENT_CATEGORIES[id].color } as CSSProperties}
            onClick={() => setCategory(id)}
          >
            {EVENT_CATEGORIES[id].label}
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      {filtered.length === 0 ? (
        <div className="card empty-state">
          <StarIcon size={40} strokeWidth={1.6} />
          <strong>No matching events</strong>
          <p className="muted footnote">
            {query || category !== 'all'
              ? 'Try another search or clear the theme filter.'
              : 'Try a practice challenge, or wait for an admin drop.'}
          </p>
          {(query || category !== 'all') && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setQuery('')
                setCategory('all')
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {filtered.map((item) => {
            const { drop } = item
            const theme = resolveCategory(drop)
            const distance =
              !item.practice && position != null
                ? Math.round(distanceM(position.coords.latitude, position.coords.longitude, drop.lat, drop.lng))
                : null
            const difficulty = difficultyForPoints(drop.points)
            return (
              <li
                key={item.key}
                className="card stack-sm"
                style={{ '--accent-local': DROP_TYPES[drop.type].color, padding: 16 } as CSSProperties}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span className="chip" style={{ '--player': DROP_TYPES[drop.type].color } as CSSProperties}>
                      <span className="color-dot" aria-hidden />
                      {DROP_TYPES[drop.type].label}
                    </span>
                    <span className="chip" style={{ '--player': EVENT_CATEGORIES[theme].color } as CSSProperties}>
                      <span className="color-dot" aria-hidden />
                      {categoryLabel(theme)}
                    </span>
                  </div>
                  <span className={`diff-pill diff-${item.practice ? 'medium' : difficulty.toLowerCase()}`}>
                    {item.practice
                      ? item.key.startsWith('spotlight-')
                        ? 'Spotlight'
                        : 'Practice'
                      : difficulty}
                  </span>
                </div>
                <h2 style={{ margin: 0, fontSize: 18 }}>{drop.title}</h2>
                <p className="muted" style={{ margin: 0 }}>
                  {item.blurb}
                  {distance !== null ? ` · ${distance} m away` : ''}
                </p>
                <Link className="button primary" to={item.href}>
                  {item.cta}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default ChallengesPage
