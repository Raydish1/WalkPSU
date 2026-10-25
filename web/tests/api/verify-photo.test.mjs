// Runs the real web/api/verify-photo.ts (auth, cheap checks, Gemini verdict, claim) against the mock Supabase,
// with Gemini replaced at the fetch level. The SQL behind photo_hunt_check/claim_photo_hunt is covered in tests/sql.
import { HUNT_SPOT, MOCK_PORT, SERVICE_ROLE_KEY, startMockSupabase } from '../mock/supabase.mjs'

const MOCK = `http://localhost:${MOCK_PORT}`
Object.assign(process.env, {
  VITE_SUPABASE_URL: MOCK,
  VITE_SUPABASE_ANON_KEY: 'mock',
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  GEMINI_API_KEY: 'test-gemini-key',
})

let failures = 0
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ' :: ' + JSON.stringify(detail)}`)
  if (!ok) failures++
}

// Gemini stand-in: answers from a queue (a verdict object, or an HTTP status for an error) and records each call.
const realFetch = globalThis.fetch
const gemini = { queue: [], calls: [] }
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input)
  if (!url.startsWith('https://generativelanguage.googleapis.com/')) return realFetch(input, init)
  gemini.calls.push({ model: url.match(/models\/([^:]+)/)?.[1], key: new Headers(init?.headers).get('x-goog-api-key') })
  const next = gemini.queue.shift() ?? 500
  if (typeof next === 'number') return new Response('{"error":"busy"}', { status: next })
  return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(next) }] } }] })
}
const verdict = (v) => ({ same_place: true, twist_done: true, photo_of_screen_or_print: false, reason: 'Looks right.', ...v })

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
const { POST } = await import('../../api/verify-photo.ts')
const AT_SPOT = { lat: HUNT_SPOT.lat, lng: HUNT_SPOT.lng }
const FAR = { lat: HUNT_SPOT.lat + 500 / 111_195, lng: HUNT_SPOT.lng }
const PHOTO = 'aGVsbG8=' // any base64; the fake referee doesn't look at it

async function submit({ sub, at = AT_SPOT, image = PHOTO, dropId = 'hunt-drop' } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(sub && { Authorization: `Bearer ${tokenFor(sub)}` }) }
  const res = await POST(new Request('http://localhost/api/verify-photo', { method: 'POST', headers, body: JSON.stringify({ dropId, image, ...at }) }))
  return { status: res.status, body: await res.json() }
}
const state = async () => (await realFetch(`${MOCK}/__state`)).json()
const huntClaims = async () => (await state()).claims.filter((c) => c.drop_id === 'hunt-drop')

try {
  let r = await submit()
  check('no token: 401', r.status === 401, r)

  r = await submit({ sub: 'stranger' })
  check('signed in but never joined: 403', r.status === 403 && /Join the game/.test(r.body.error), r)

  const ana = await joinAs('ana', 'Ana')
  const ben = await joinAs('ben', 'Ben')

  r = await submit({ sub: 'ana', at: FAR })
  check('far from the hidden spot: refused before any Gemini call', r.status === 400 && /isn't the spot/.test(r.body.error) && gemini.calls.length === 0, { r, calls: gemini.calls.length })

  r = await submit({ sub: 'ana', image: 'x'.repeat(6_000_000) })
  check('oversized photo: 413', r.status === 413, r.status)

  gemini.queue.push(verdict({ same_place: false, reason: 'Different building.' }))
  r = await submit({ sub: 'ana' })
  check("wrong place: no match, referee's reason passed through", r.status === 200 && r.body.match === false && r.body.reason === 'Different building.', r)

  gemini.queue.push(verdict({ twist_done: false }))
  r = await submit({ sub: 'ana' })
  check('twist not done: no match', r.body.match === false, r)

  gemini.queue.push(verdict({ photo_of_screen_or_print: true }))
  r = await submit({ sub: 'ana' })
  check('photo of a screen: no match', r.body.match === false, r)
  check('no claim recorded for any rejected photo', (await huntClaims()).length === 0, await huntClaims())
  check('Gemini called with the server-side key', gemini.calls.every((c) => c.key === 'test-gemini-key'), gemini.calls)

  gemini.calls.length = 0
  gemini.queue.push(503, verdict({}))
  r = await submit({ sub: 'ana' })
  check('Gemini busy once: retried, then a match for the full 20 points', r.body.match === true && r.body.points === 20 && gemini.calls.length === 2, { r, calls: gemini.calls })
  const hunt = (await state()).drops.find((d) => d.id === 'hunt-drop')
  check('first find reveals the spot and starts the 7-minute window', hunt.first_found_at !== null && hunt.lat === HUNT_SPOT.lat, hunt)

  gemini.calls.length = 0
  r = await submit({ sub: 'ana' })
  check('same player again: refused, no Gemini call', r.status === 400 && /already found/.test(r.body.error) && gemini.calls.length === 0, r)

  gemini.queue.push(verdict({}))
  r = await submit({ sub: 'ben' })
  check('second finder earns half (10 points)', r.body.match === true && r.body.points === 10, r)
  const claims = await huntClaims()
  check('claims belong to the right players', claims.length === 2 && claims[0].player_id === ana.id && claims[1].player_id === ben.id, claims)

  // The service-only functions can't be called with a player's own token.
  const direct = await realFetch(`${MOCK}/rest/v1/rpc/claim_photo_hunt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: 'mock', Authorization: `Bearer ${tokenFor('ben')}` },
    body: JSON.stringify({ p_drop_id: 'hunt-drop', p_player_id: ben.id, p_lat: AT_SPOT.lat, p_lng: AT_SPOT.lng }),
  })
  check("a player can't call claim_photo_hunt directly", direct.status === 403, direct.status)
} catch (e) {
  failures++
  console.log(`FAIL crashed :: ${e.stack}`)
} finally {
  mock.close()
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll API checks passed')
process.exit(failures ? 1 : 0)
