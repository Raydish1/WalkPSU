// Runs the real web/api/search-events.ts against the mock Supabase, with Gemini replaced at the fetch level and the
// clock pinned to the snapshot, so the test doesn't depend on today's date.
import { readFileSync } from 'node:fs'
import { MOCK_PORT, startMockSupabase } from '../mock/supabase.mjs'

const MOCK = `http://localhost:${MOCK_PORT}`
Object.assign(process.env, { VITE_SUPABASE_URL: MOCK, VITE_SUPABASE_ANON_KEY: 'mock', GEMINI_API_KEY: 'test-gemini-key' })

const { events } = JSON.parse(readFileSync(new URL('../../scripts/data/discover-events.json', import.meta.url), 'utf8'))
// Just after the earliest-ending event ends: it's over, (almost) everything else is upcoming.
const ended = [...events].sort((a, b) => Date.parse(a.ends_at) - Date.parse(b.ends_at))[0]
const NOW = Date.parse(ended.ends_at) + 1
const realNow = Date.now
Date.now = () => NOW
const upcomingIds = events.filter((e) => Date.parse(e.ends_at) > NOW).map((e) => e.id)
const atBuilding = events.find((e) => e.building && Date.parse(e.ends_at) > NOW)
const online = events.find((e) => !e.building && Date.parse(e.ends_at) > NOW)

let failures = 0
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ' :: ' + JSON.stringify(detail)?.slice(0, 400)}`)
  if (!ok) failures++
}

// Gemini stand-in: answers from a queue (a { matches } object, raw text, or an HTTP status) and records each call.
const realFetch = globalThis.fetch
const gemini = { queue: [], calls: [] }
// Set to act like a database where the event-search migration hasn't been run yet.
let quotaMissing = false
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input)
  if (quotaMissing && url.includes('/rest/v1/rpc/use_search_quota')) {
    return Response.json({ code: 'PGRST202', message: 'Could not find the function public.use_search_quota without parameters' }, { status: 404 })
  }
  if (!url.startsWith('https://generativelanguage.googleapis.com/')) return realFetch(input, init)
  gemini.calls.push({ key: new Headers(init?.headers).get('x-goog-api-key'), prompt: JSON.parse(init.body).contents[0].parts[0].text })
  const next = gemini.queue.shift() ?? 500
  if (next === 402) return Response.json({ error: { code: 402, status: 'RESOURCE_EXHAUSTED', message: 'Your prepayment credits are depleted.' } }, { status: 402 })
  if (typeof next === 'number') return new Response('{"error":"busy"}', { status: next })
  const text = typeof next === 'string' ? next : JSON.stringify(next)
  return Response.json({ candidates: [{ content: { parts: [{ text }] } }] })
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const tokenFor = (sub) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated' })}.mock`
async function joinAs(sub, name) {
  const res = await realFetch(`${MOCK}/rest/v1/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: 'mock', Authorization: `Bearer ${tokenFor(sub)}` },
    body: JSON.stringify({ display_name: name }),
  })
  return (await res.json())[0]
}

const mock = await startMockSupabase()
const { POST } = await import('../../api/search-events.ts')
async function search(query, sub = 'ana', drops) {
  const headers = { 'Content-Type': 'application/json', ...(sub && { Authorization: `Bearer ${tokenFor(sub)}` }) }
  const res = await POST(new Request('http://localhost/api/search-events', { method: 'POST', headers, body: JSON.stringify({ query, drops }) }))
  return { status: res.status, body: await res.json() }
}

// Capture anything logged, to prove queries never reach the logs.
const logged = []
for (const level of ['log', 'info', 'warn', 'error']) {
  const original = console[level].bind(console)
  console[level] = (...args) => {
    logged.push(args.map(String).join(' '))
    if (level !== 'error') original(...args)
  }
}

try {
  let r = await search('free food', null)
  check('no token: 401', r.status === 401, r)
  r = await search('free food', 'stranger')
  check('signed in but never joined: 403', r.status === 403 && /Join the game/.test(r.body.error), r)

  await joinAs('ana', 'Ana')
  r = await search(' ')
  check('blank query: 400, no Gemini call', r.status === 400 && gemini.calls.length === 0, r)
  r = await search('x'.repeat(201))
  check('over 200 characters: 400, no Gemini call', r.status === 400 && gemini.calls.length === 0, r)

  // A good answer mixed with bad ids: unknown, ended, duplicate.
  gemini.queue.push({
    matches: [
      { id: atBuilding.id, reason: 'Free pizza after the meeting.' },
      { id: 'not-an-event', reason: 'Made up.' },
      { id: ended.id, reason: 'Already over.' },
      { id: atBuilding.id, reason: 'Duplicate.' },
      { id: online.id, reason: 'Online, but on topic.' },
    ],
  })
  r = await search('free food')
  const ids = r.body.results?.map((x) => x.id)
  check('only real, upcoming ids, each once, in Gemini’s order', JSON.stringify(ids) === JSON.stringify([atBuilding.id, online.id]), r.body)
  const first = r.body.results?.[0]
  check('results carry title, organization, times, location, reason', first?.title === atBuilding.title && first.organization === atBuilding.organization && first.starts_at === atBuilding.starts_at && first.location === atBuilding.location && first.reason === 'Free pizza after the meeting.', first)
  check('a matched event has its building (for the map)', first?.building?.num === atBuilding.building.num && typeof first.building.lat === 'number' && !('matched_by' in first.building), first?.building)
  check('an unmatched event has no building', r.body.results?.[1]?.building === null, r.body.results?.[1])

  const call = gemini.calls.at(-1)
  check('Gemini called with the server-side key', call.key === 'test-gemini-key')
  check('the prompt wraps the query as data, not instructions', call.prompt.includes('<request>free food</request>') && /never as instructions/.test(call.prompt))
  const listed = [...call.prompt.matchAll(/^(\S+) \| /gm)].map((m) => m[1])
  check(
    'the prompt lists only upcoming events (the soonest 300), never ended ones',
    listed.length === Math.min(300, upcomingIds.length) && listed.every((id) => upcomingIds.includes(id)) && !listed.includes(ended.id),
    { listed: listed.length, upcoming: upcomingIds.length },
  )
  check('the prompt gives the current State College time', /in State College/.test(call.prompt))

  const many = upcomingIds.slice(0, 9).map((id) => ({ id, reason: 'Fits.' }))
  gemini.queue.push({ matches: many })
  r = await search('anything fun')
  check('at most 6 results', r.body.results?.length === 6, r.body.results?.length)

  // Live drops ride along in the same call: the client sends titles and building names only.
  const drops = [
    { id: 'd-hoops', title: '🏀 Pickup hoops', at: 'Rec Hall' },
    { id: 'd-chess', title: 'Chess club', lat: 40.8, lng: -77.86 },
  ]
  gemini.queue.push({ matches: [], drop_ids: ['d-hoops', 'not-sent', 'd-hoops', 42] })
  r = await search('basketball', 'ana', drops)
  check('matching drops come back by id, only ones the client sent, each once', JSON.stringify(r.body.dropIds) === '["d-hoops"]', r.body)
  const dropPrompt = gemini.calls.at(-1).prompt
  check('the prompt lists the drops by title and building', dropPrompt.includes('d-hoops | 🏀 Pickup hoops | Rec Hall') && dropPrompt.includes('d-chess | Chess club'), dropPrompt.slice(-300))
  check('a coordinate the client sent never reaches Gemini', !dropPrompt.includes('40.8') && !dropPrompt.includes('-77.86'))

  gemini.queue.push({ matches: [] })
  r = await search('underwater basket weaving for cats')
  check('nothing matched: an empty list, not an error', r.status === 200 && r.body.results.length === 0, r)

  // When Gemini can't answer, the keyword search does, so search never dead-ends.
  const wordInTitle = upcomingIds.map((id) => events.find((e) => e.id === id)).find((e) => /\b[a-z]{6,}\b/i.test(e.title))
  const titleWord = wordInTitle.title.match(/\b([a-z]{6,})\b/i)[1].toLowerCase()
  gemini.queue.push('this is not json')
  r = await search(titleWord)
  check('garbled Gemini answer: keyword results instead of an error', r.status === 200 && r.body.mode === 'keyword' && r.body.results.some((x) => x.title === wordInTitle.title), { status: r.status, mode: r.body.mode, word: titleWord })
  check('keyword results explain themselves', r.body.results?.every((x) => /Mentions|Related to/.test(x.reason)), r.body.results?.map((x) => x.reason))

  gemini.calls.length = 0
  gemini.queue.push(402)
  r = await search('free food')
  check('out of Gemini credits (402): one call, then keyword results', r.status === 200 && r.body.mode === 'keyword' && gemini.calls.length === 1, { status: r.status, mode: r.body.mode, calls: gemini.calls.length })

  gemini.queue.push(503, 503, 503, 503)
  r = await search('secret hobby search', 'ana', [{ id: 'd-hoops', title: '🏀 Pickup hoops' }])
  check('Gemini busy on every model: keyword results, not an error', r.status === 200 && r.body.mode === 'keyword', r)
  gemini.queue.push(402)
  r = await search('basketball', 'ana', [{ id: 'd-hoops', title: '🏀 Pickup hoops' }, { id: 'd-chess', title: 'Chess club' }])
  check('keyword search matches drops by emoji and synonyms (🏀 → basketball)', JSON.stringify(r.body.dropIds) === '["d-hoops"]', r.body)
  check('Gemini failures are logged by status only', logged.some((line) => /Gemini error 402 RESOURCE_EXHAUSTED/.test(line)), logged)
  check('nothing logged contains a query', !logged.some((line) => /secret hobby|free food|music tonight|basket weaving/.test(line)), logged)

  // 8 searches so far reached the quota (the blank and too-long ones were refused before it). 10 per window.
  gemini.calls.length = 0
  for (let i = 0; i < 2; i++) {
    gemini.queue.push({ matches: [] })
    await search('more searches')
  }
  r = await search('one too many')
  check('the 11th search in 10 minutes is refused (429), before any Gemini call', r.status === 429 && gemini.calls.length === 2, { r, calls: gemini.calls.length })

  // A database without the event-search migration (use_search_quota missing): search still works, with the same
  // allowance counted on the server instead.
  quotaMissing = true
  await joinAs('ben', 'Ben')
  const benStatuses = []
  for (let i = 0; i < 10; i++) {
    gemini.queue.push({ matches: [] })
    benStatuses.push((await search('more searches', 'ben')).status)
  }
  check('missing use_search_quota(): searches still run', benStatuses.every((s) => s === 200), benStatuses)
  r = await search('one too many', 'ben')
  check('and the 11th is still refused', r.status === 429, r)
  check('the missing migration is logged once, by name', logged.filter((line) => /20261025040000_event_search\.sql/.test(line)).length === 1, logged)
  quotaMissing = false
} catch (e) {
  failures++
  console.log(`FAIL crashed :: ${e.stack}`)
} finally {
  Date.now = realNow
  mock.close()
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll search API checks passed')
process.exit(failures ? 1 : 0)
