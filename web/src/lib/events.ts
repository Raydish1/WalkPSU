import { DROP_TYPES } from './campus'
import type { DropRow, DropType } from './database.types'

/** Campus event themes for search / filter (basketball, culture, etc.). */
export const EVENT_CATEGORIES = {
  sports: {
    label: 'Sports',
    color: '#3d8fc7',
    keywords: [
      'basketball',
      'football',
      'soccer',
      'baseball',
      'volleyball',
      'hockey',
      'athletic',
      'athletics',
      'game day',
      'gameday',
      'bjc',
      'stadium',
      'pegula',
      'nittany',
      'intramural',
    ],
  },
  culture: {
    label: 'Culture',
    color: '#7eb6e8',
    keywords: [
      'culture',
      'cultural',
      'art',
      'arts',
      'music',
      'theater',
      'theatre',
      'museum',
      'festival',
      'film',
      'dance',
      'heritage',
      'gallery',
      'concert',
      'performance',
    ],
  },
  academics: {
    label: 'Academics',
    color: '#2f7eb5',
    keywords: [
      'math',
      'chemistry',
      'science',
      'lab',
      'study',
      'lecture',
      'quiz',
      'mental',
      'osmond',
      'class',
      'stem',
      'exam',
    ],
  },
  social: {
    label: 'Social',
    color: '#5ba8e0',
    keywords: ['social', 'party', 'meetup', 'club', 'hangout', 'shake', 'mixer', 'welcome', 'friends'],
  },
  campus: {
    label: 'Campus',
    color: '#a8d4f0',
    keywords: ['check-in', 'checkin', 'tour', 'explore', 'lawn', 'photo', 'landmark', 'walk', 'demo'],
  },
} as const

export type EventCategoryId = keyof typeof EVENT_CATEGORIES

const TYPE_FALLBACK: Record<DropType, EventCategoryId> = {
  minigame: 'social',
  photo_hunt: 'culture',
  checkin: 'campus',
  math: 'academics',
  chemistry: 'academics',
}

/** Prefer stored category; otherwise infer from title keywords and drop type. */
export function resolveCategory(drop: Pick<DropRow, 'title' | 'type'> & { category?: string | null }): EventCategoryId {
  const stored = drop.category
  if (stored && stored in EVENT_CATEGORIES) return stored as EventCategoryId

  const hay = `${drop.title} ${DROP_TYPES[drop.type]?.label ?? ''}`.toLowerCase()
  for (const [id, meta] of Object.entries(EVENT_CATEGORIES) as [EventCategoryId, (typeof EVENT_CATEGORIES)[EventCategoryId]][]) {
    if (meta.keywords.some((k) => hay.includes(k))) return id
  }
  return TYPE_FALLBACK[drop.type as keyof typeof TYPE_FALLBACK] ?? 'campus'
}

export function categoryLabel(id: EventCategoryId): string {
  return EVENT_CATEGORIES[id].label
}

/** Case-insensitive match across title, type, and category. */
export function matchesEventQuery(
  drop: Pick<DropRow, 'title' | 'type'> & { category?: string | null },
  query: string,
  category: EventCategoryId | 'all',
): boolean {
  const resolved = resolveCategory(drop)
  if (category !== 'all' && resolved !== category) return false

  const q = query.trim().toLowerCase()
  if (!q) return true

  const typeLabel = DROP_TYPES[drop.type]?.label ?? drop.type
  const catLabel = categoryLabel(resolved)
  const hay = `${drop.title} ${typeLabel} ${catLabel} ${resolved}`.toLowerCase()
  return q.split(/\s+/).every((token) => hay.includes(token))
}
