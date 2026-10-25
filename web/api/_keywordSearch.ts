// Event search without Gemini: keyword and synonym matching, plus time words ("tonight"). Used by search-events.ts
// whenever Gemini can't answer (out of credits, overloaded, garbled), so search never dead-ends. Leading underscore:
// not an endpoint.

export type KeywordEvent = {
  id: string
  title: string
  organization: string | null
  theme: string | null
  categories: string[]
  starts_at: string
  ends_at: string
  location: string | null
}
export type KeywordDrop = { id: string; title: string; at?: string }

const MAX_RESULTS = 6

/** Words that say nothing about what someone wants. */
const STOPWORDS = new Set(
  'a an and any anything are at be can do event events find for from fun get go good have i im in is it like looking me my near of on or out place play some something stuff that the there things this to want what where with would you'.split(' '),
)

/** What a request word can also mean. A query word in a group matches any word of that group. */
const GROUPS: { name: string; words: string[] }[] = [
  { name: 'food', words: ['food', 'free', 'pizza', 'snack', 'lunch', 'dinner', 'breakfast', 'brunch', 'eat', 'treat', 'cookie', 'donut', 'coffee', 'bbq', 'cookout', 'dessert', 'ice cream', 'potluck', 'refreshment', 'tasting', 'bake', 'candy', 'pancake'] },
  { name: 'music', words: ['music', 'concert', 'band', 'jazz', 'choir', 'orchestra', 'sing', 'a cappella', 'acapella', 'dj', 'open mic', 'recital', 'symphony', 'karaoke', 'song', 'rap', 'hip hop'] },
  { name: 'sports', words: ['sport', 'basketball', 'hoops', 'football', 'soccer', 'volleyball', 'hockey', 'tennis', 'baseball', 'softball', 'lacrosse', 'wrestling', 'run', '5k', 'fitness', 'workout', 'yoga', 'intramural', 'rec', 'athletic', 'climb', 'swim', 'pickleball', 'frisbee'] },
  { name: 'tech', words: ['cs', 'computer', 'computing', 'coding', 'code', 'programming', 'software', 'hack', 'hackathon', 'tech', 'ai', 'data', 'cyber', 'ist', 'robot', 'developer', 'engineering', 'app', 'startup'] },
  { name: 'arts', words: ['art', 'paint', 'draw', 'gallery', 'exhibit', 'museum', 'theatre', 'theater', 'film', 'movie', 'dance', 'craft', 'photo', 'poetry', 'design', 'comedy', 'improv'] },
  { name: 'games', words: ['game', 'gaming', 'esport', 'board game', 'trivia', 'video game', 'chess', 'd&d', 'bingo', 'puzzle', 'tournament'] },
  { name: 'social', words: ['social', 'party', 'mixer', 'meet', 'hangout', 'friend', 'club', 'community', 'celebration', 'festival', 'night'] },
  { name: 'career', words: ['career', 'job', 'internship', 'resume', 'interview', 'networking', 'recruit', 'employer', 'professional', 'workshop'] },
  { name: 'learning', words: ['study', 'lecture', 'talk', 'seminar', 'research', 'class', 'tutoring', 'learn', 'academic', 'speaker'] },
  { name: 'culture', words: ['culture', 'cultural', 'heritage', 'international', 'diversity', 'language', 'faith', 'spiritual'] },
  { name: 'service', words: ['volunteer', 'service', 'fundraiser', 'fundraising', 'charity', 'donate', 'thon'] },
]

/** Emoji people use in drop titles and quick picks. */
const EMOJI: Record<string, string> = {
  '🏀': 'basketball', '⚽': 'soccer', '🏈': 'football', '🏐': 'volleyball', '🎾': 'tennis', '⚾': 'baseball', '🏒': 'hockey',
  '🎵': 'music', '🎶': 'music', '🎸': 'music', '🎤': 'karaoke', '🍕': 'pizza', '🍔': 'food', '🌮': 'food', '🍩': 'donut',
  '☕': 'coffee', '🎨': 'art', '🎭': 'theater', '🎬': 'movie', '🎮': 'game', '♟': 'chess', '💻': 'tech', '📚': 'study',
}

const normalize = (text: string) =>
  [...text.toLowerCase()].map((ch) => (EMOJI[ch] ? ` ${EMOJI[ch]} ` : ch)).join('').replace(/[^a-z0-9&\s]+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Long terms match a word's start, so "snack" finds "snacks". Short ones must be the whole word (or its plural), so
 * "ai" doesn't find "air" and "app" doesn't find "appreciate".
 */
const has = (text: string, term: string) => {
  const t = term.replace(/[&]/g, '\\$&')
  return new RegExp(term.length <= 4 ? `(^| )${t}(s|es)?( |$)` : `(^| )${t}`).test(text)
}

type Term = { word: string; group: string | null; direct: boolean }

function termsFor(query: string): Term[] {
  const words = normalize(query).split(' ').filter((w) => w.length > 1 && !STOPWORDS.has(w) && !TIME_WORDS.has(w))
  const terms = new Map<string, Term>()
  for (const word of words) {
    terms.set(word, { word, group: null, direct: true })
    // "free" alone means free food on a college campus; other words expand to their whole group.
    for (const group of GROUPS) {
      if (!group.words.some((g) => g === word || (word.length > 3 && g.startsWith(word)))) continue
      for (const synonym of group.words) if (!terms.has(synonym)) terms.set(synonym, { word: synonym, group: group.name, direct: false })
    }
  }
  return [...terms.values()]
}

// --- Time words, in State College time

const TIME_WORDS = new Set(['tonight', 'today', 'tomorrow', 'weekend', 'now', 'soon', 'later', 'morning', 'afternoon', 'evening'])
const eastern = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })

function local(ms: number) {
  const parts = Object.fromEntries(eastern.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: parts.weekday as string }
}

type Window = { label: string; fits: (e: KeywordEvent) => boolean }

function timeWindow(query: string, now: number): Window | null {
  const q = normalize(query)
  const day = (ms: number) => local(ms).date
  const today = day(now)
  const tomorrow = day(now + 24 * 3600_000)
  const live = (e: KeywordEvent) => Date.parse(e.starts_at) <= now && Date.parse(e.ends_at) > now
  if (/\b(now|right now)\b/.test(q)) return { label: 'Happening now', fits: live }
  if (/\btonight\b/.test(q) || /\bthis evening\b/.test(q)) {
    return {
      label: 'Tonight',
      fits: (e) => {
        const s = local(Date.parse(e.starts_at))
        return (s.date === today && s.hour >= 16) || (s.date === tomorrow && s.hour < 3) || (live(e) && local(Date.parse(e.ends_at)).hour >= 18)
      },
    }
  }
  if (/\btomorrow\b/.test(q)) return { label: 'Tomorrow', fits: (e) => day(Date.parse(e.starts_at)) === tomorrow }
  if (/\btoday\b/.test(q)) return { label: 'Today', fits: (e) => day(Date.parse(e.starts_at)) === today || live(e) }
  if (/\bweekend\b/.test(q)) {
    return {
      label: 'This weekend',
      fits: (e) => {
        const start = Date.parse(e.starts_at)
        const s = local(start)
        return start - now < 7 * 24 * 3600_000 && (s.weekday === 'Sat' || s.weekday === 'Sun' || (s.weekday === 'Fri' && s.hour >= 16))
      },
    }
  }
  return null
}

// --- Ranking

function score(fields: { text: string; weight: number }[], terms: Term[]) {
  let total = 0
  let best: { term: Term; weight: number } | null = null
  for (const term of terms) {
    for (const { text, weight } of fields) {
      if (!has(text, term.word)) continue
      const points = weight * (term.direct ? 2 : 1)
      total += points
      if (!best || points > best.weight) best = { term, weight: points }
      break // one field per term is enough
    }
  }
  return { total, best }
}

function reasonFor(best: { term: Term } | null, window: Window | null) {
  const parts: string[] = []
  if (best) parts.push(best.term.direct ? `Mentions “${best.term.word}”.` : `Related to ${best.term.group}: mentions “${best.term.word}”.`)
  if (window) parts.push(`${window.label}.`)
  return parts.join(' ')
}

/** Picks events and drops for `query` without AI. Same shape as Gemini's answer. */
export function keywordSearch(query: string, events: KeywordEvent[], drops: KeywordDrop[], now: number) {
  const terms = termsFor(query)
  const window = timeWindow(query, now)

  const ranked = events
    .filter((e) => !window || window.fits(e))
    .map((e) => {
      const { total, best } = score(
        [
          { text: normalize(e.title), weight: 3 },
          { text: normalize([e.theme ?? '', ...e.categories].join(' ')), weight: 2 },
          { text: normalize(`${e.organization ?? ''} ${e.location ?? ''}`), weight: 1 },
        ],
        terms,
      )
      return { e, total, best }
    })
    // Only time words ("anything tonight"): everything in that window counts.
    .filter((r) => r.total > 0 || (terms.length === 0 && window))
    .sort((a, b) => b.total - a.total || Date.parse(a.e.starts_at) - Date.parse(b.e.starts_at))
    // Repeat sessions of one event (same title) show once: its soonest, best-scoring session.
    .filter((r, i, all) => all.findIndex((o) => o.e.title === r.e.title) === i)
    .slice(0, MAX_RESULTS)

  const dropIds = terms.length
    ? drops.filter((d) => score([{ text: normalize(`${d.title} ${d.at ?? ''}`), weight: 1 }], terms).total > 0).map((d) => d.id)
    : []

  return { matches: ranked.map((r) => ({ id: r.e.id, reason: reasonFor(r.best, window) })), drop_ids: dropIds }
}
