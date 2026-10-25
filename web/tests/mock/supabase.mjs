// In-memory stand-in for the Supabase REST/auth/RPC endpoints the app uses, for UI tests without a real project.
// It mirrors the SQL rules closely enough to drive the screens (60 m claim radius, QR codes, Shake-Off timing and
// caps, photo hunts) but it is not the source of truth: tests/sql checks the real functions. No Realtime: the app's refresh() and
// polling fallbacks keep screens current, exactly as on flaky venue Wi-Fi.
//
//   node tests/mock/supabase.mjs            # serves on :54321
//   VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY=mock npm run dev
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

export const MOCK_PORT = 54321
export const OLD_MAIN_LAWN = { lat: 40.7982, lng: -77.8599 }
/** The hidden photo hunt's real spot, ~250 m north of the lawn. Its search circle is centered 60 m east of it. */
export const HUNT_SPOT = { lat: OLD_MAIN_LAWN.lat + 250 / 111_195, lng: OLD_MAIN_LAWN.lng }
const HUNT_WINDOW_MS = 7 * 60_000
const RADIUS_M = 60
// A shorter countdown than production so tests run fast; the client must take timing from here, not hard-code it.
const SETTINGS = { game_seconds: 15, auto_start_players: 4, auto_start_delay_seconds: 4, admin_start_delay_seconds: 3, max_shakes_per_second: 8, submit_grace_seconds: 3 }
const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4']
const BOT_SHAKES = 20

const R = 6371000
const rad = (d) => (d * Math.PI) / 180
const distance = (a, b, c, d) => 2 * R * Math.asin(Math.sqrt(Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2))
const now = () => new Date().toISOString()

function seed() {
  const players = [{ id: 'rival', auth_id: 'rival', display_name: 'Rival <b>Ray</b>', color: PALETTE[0], is_admin: false, created_at: now() }]
  for (const [i, name] of ['Bot Ana', 'Bot Ben', 'Bot Cal'].entries()) {
    players.push({ id: `bot${i}`, auth_id: `bot${i}`, display_name: name, color: PALETTE[i + 1], is_admin: false, created_at: now() })
  }
  const drop = (id, title, type, lat, lng, points, building_num, extra = {}) => ({
    id, title, type, lat, lng, points, status: 'active', hint_photo_url: null, building_num, created_by: null, created_at: now(), expires_at: null,
    twist: null, search_radius_m: null, first_found_at: null, ...extra,
  })
  const drops = [
    drop('center-drop', 'Old Main lawn', 'checkin', OLD_MAIN_LAWN.lat, OLD_MAIN_LAWN.lng, 15, null),
    // ~30 m east of the lawn drop, at the HUB (so the map highlights building 0005000).
    drop('game-drop', 'HUB Shake-Off', 'minigame', OLD_MAIN_LAWN.lat, OLD_MAIN_LAWN.lng + 30 / (111_195 * Math.cos(rad(OLD_MAIN_LAWN.lat))), 30, '0005000'),
    // Hidden photo hunt: the public row has only the search circle's center and no building.
    drop('hunt-drop', 'Mystery spot', 'photo_hunt', HUNT_SPOT.lat, HUNT_SPOT.lng + 60 / (111_195 * Math.cos(rad(HUNT_SPOT.lat))), 20, null, {
      twist: 'with a thumbs up',
      search_radius_m: 125,
    }),
  ]
  const hunt = { hunt_lat: HUNT_SPOT.lat, hunt_lng: HUNT_SPOT.lng, hunt_building_num: null }
  return {
    players,
    drops,
    claims: [],
    secrets: drops.map((d) => ({ drop_id: d.id, claim_code: `${d.id}-code`, ...(d.type === 'photo_hunt' ? hunt : {}) })),
    games: new Map([['game-drop', { drop_id: 'game-drop', created_at: now(), started_at: null, finished_at: null, winner_side: null }]]),
    gamePlayers: ['bot0', 'bot1', 'bot2'].map((id, i) => ({ drop_id: 'game-drop', player_id: id, joined_at: new Date(Date.now() - 60_000 + i).toISOString(), shakes: 0 })),
    log: [],
  }
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (sub) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.mock`
const subFrom = (req) => {
  try {
    return JSON.parse(Buffer.from((req.headers.authorization ?? '').split(' ')[1].split('.')[1], 'base64url')).sub
  } catch {
    return null
  }
}

/** Supports the PostgREST filters the app sends: `col=eq.value`; ordering and `or=` are ignored. */
const filterRows = (rows, params) =>
  rows.filter((row) => [...params].every(([k, v]) => !v.startsWith('eq.') || String(row[k]) === v.slice(3)))

export function startMockSupabase({ port = MOCK_PORT } = {}) {
  const db = seed()
  const { players, drops, claims, secrets, games, gamePlayers, log } = db

  const sidesOf = (dropId) => {
    if (!games.get(dropId)?.started_at) return new Map()
    const roster = gamePlayers.filter((gp) => gp.drop_id === dropId).sort((a, b) => a.joined_at.localeCompare(b.joined_at))
    return new Map(roster.map((gp, i) => [gp.player_id, i % 2 === 0 ? 'blue' : 'white']))
  }
  const gameState = (dropId) => {
    const sides = sidesOf(dropId)
    return {
      server_now: now(),
      settings: SETTINGS,
      game: games.get(dropId) ?? null,
      players: gamePlayers
        .filter((gp) => gp.drop_id === dropId)
        .map((gp) => {
          const p = players.find((x) => x.id === gp.player_id)
          return { player_id: p.id, display_name: p.display_name, color: p.color, side: sides.get(p.id) ?? null, shakes: gp.shakes, joined_at: gp.joined_at }
        }),
    }
  }
  const scores = () =>
    players
      .map((p) => ({
        player_id: p.id,
        display_name: p.display_name,
        color: p.color,
        points: claims.filter((c) => c.player_id === p.id).reduce((sum, c) => sum + c.points, 0),
        claims: claims.filter((c) => c.player_id === p.id).length,
      }))
      .sort((a, b) => b.points - a.points || a.display_name.localeCompare(b.display_name))
  const proofOk = (json, drop) =>
    json.p_code != null
      ? json.p_code === secrets.find((s) => s.drop_id === drop.id)?.claim_code
      : json.p_lat != null && distance(json.p_lat, json.p_lng, drop.lat, drop.lng) <= RADIUS_M

  const rpc = {
    claim_radius_m: () => [200, RADIUS_M],
    claim_drop: (json, me) => {
      const drop = drops.find((d) => d.id === json.p_drop_id)
      if (!me) return [400, { message: 'Join the game before claiming drops' }]
      if (drop?.type === 'minigame') return [400, { message: 'This drop is a Shake-Off. Join its lobby to win it' }]
      if (drop?.type === 'photo_hunt') return [400, { message: 'Photo hunts are claimed by taking the photo' }]
      if (!drop || drop.status !== 'active') return [400, { message: 'This drop is no longer available' }]
      if (!proofOk(json, drop)) return [400, { message: json.p_code != null ? "That QR code doesn't match this drop" : 'Get closer to claim this drop' }]
      drop.status = 'claimed'
      const claim = { id: randomUUID(), drop_id: drop.id, player_id: me.id, points: drop.points, created_at: now() }
      claims.push(claim)
      return [200, claim]
    },
    create_photo_hunt: (json, me) => {
      if (!me?.is_admin) return [400, { message: 'Only admins can create photo hunts' }]
      const d = {
        id: randomUUID(), title: json.p_title, type: 'photo_hunt', lat: json.p_lat + 50 / 111_195, lng: json.p_lng, points: json.p_points ?? 10,
        status: 'active', hint_photo_url: json.p_hint_photo_url, building_num: null, created_by: me.id, created_at: now(),
        expires_at: json.p_expires_at ?? null, twist: json.p_twist.trim(), search_radius_m: 125, first_found_at: null,
      }
      drops.push(d)
      secrets.push({ drop_id: d.id, claim_code: randomUUID().replaceAll('-', ''), hunt_lat: json.p_lat, hunt_lng: json.p_lng, hunt_building_num: json.p_building_num ?? null })
      return [200, d]
    },
    get_game_state: (json) => [200, gameState(json.p_drop_id)],
    join_game: (json, me) => {
      const g = games.get(json.p_drop_id)
      if (gamePlayers.some((gp) => gp.drop_id === json.p_drop_id && gp.player_id === me.id)) return [200, null]
      if (g.started_at && Date.parse(g.started_at) <= Date.now()) return [400, { message: 'This Shake-Off already started' }]
      if (!proofOk(json, drops.find((d) => d.id === json.p_drop_id))) return [400, { message: 'Get closer to this drop' }]
      gamePlayers.push({ drop_id: json.p_drop_id, player_id: me.id, joined_at: now(), shakes: 0 })
      if (!g.started_at && gamePlayers.filter((gp) => gp.drop_id === json.p_drop_id).length >= SETTINGS.auto_start_players) {
        g.started_at = new Date(Date.now() + SETTINGS.auto_start_delay_seconds * 1000).toISOString()
      }
      return [200, null]
    },
    start_game: (json, me) => {
      const g = games.get(json.p_drop_id)
      if (!me?.is_admin) return [400, { message: 'Only admins can start a Shake-Off' }]
      const start = Date.now() + SETTINGS.admin_start_delay_seconds * 1000
      if (!g.started_at || Date.parse(g.started_at) > start) g.started_at = new Date(start).toISOString()
      return [200, null]
    },
    submit_shakes: (json, me) => {
      const started = Date.parse(games.get(json.p_drop_id)?.started_at ?? '')
      if (!started || Date.now() < started) return [400, { message: "This Shake-Off hasn't started" }]
      if (Date.now() > started + (SETTINGS.game_seconds + SETTINGS.submit_grace_seconds) * 1000) return [400, { message: 'This Shake-Off is over' }]
      const gp = gamePlayers.find((x) => x.drop_id === json.p_drop_id && x.player_id === me.id)
      const elapsed = Math.min((Date.now() - started) / 1000, SETTINGS.game_seconds)
      gp.shakes = Math.max(gp.shakes, Math.min(Math.max(json.p_count, 0), Math.floor(elapsed * SETTINGS.max_shakes_per_second)))
      log.push(`submit ${json.p_count} -> stored ${gp.shakes} at ${elapsed.toFixed(1)}s`)
      return [200, gp.shakes]
    },
    finish_game: (json) => {
      const g = games.get(json.p_drop_id)
      if (!g.finished_at) {
        if (Date.now() < Date.parse(g.started_at) + (SETTINGS.game_seconds + SETTINGS.submit_grace_seconds) * 1000) return [400, { message: "This Shake-Off isn't over yet" }]
        for (const gp of gamePlayers) if (gp.player_id.startsWith('bot')) gp.shakes = BOT_SHAKES
        const sides = sidesOf(json.p_drop_id)
        const avg = (side) => {
          const xs = gamePlayers.filter((gp) => sides.get(gp.player_id) === side).map((gp) => gp.shakes)
          return xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
        }
        g.winner_side = avg('blue') >= avg('white') ? 'blue' : 'white'
        g.finished_at = now()
        drops.find((d) => d.id === json.p_drop_id).status = 'claimed'
        const points = drops.find((d) => d.id === json.p_drop_id).points
        for (const gp of gamePlayers) if (sides.get(gp.player_id) === g.winner_side) claims.push({ id: randomUUID(), drop_id: json.p_drop_id, player_id: gp.player_id, points, created_at: g.finished_at })
        log.push(`finish: blue ${avg('blue')} white ${avg('white')} -> ${g.winner_side}`)
      }
      return [200, gameState(json.p_drop_id)]
    },
  }

  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Allow-Methods', '*')
    res.setHeader('Access-Control-Expose-Headers', '*')
    if (req.method === 'OPTIONS') return res.end()
    let body = ''
    for await (const chunk of req) body += chunk
    const json = body ? JSON.parse(body) : {}
    const url = new URL(req.url, 'http://mock')
    const send = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(data))
    }
    const single = (req.headers.accept ?? '').includes('vnd.pgrst.object')
    const reply = (rows) => (single ? (rows.length === 1 ? send(200, rows[0]) : send(406, { message: 'expected one row' })) : send(200, rows))

    // Test-only introspection, e.g. to read claims or a drop's QR code.
    if (url.pathname === '/__state') return send(200, { log, players, drops, claims, secrets, gamePlayers, games: [...games.values()] })
    if (url.pathname === '/auth/v1/signup') {
      const id = randomUUID()
      const user = { id, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: now() }
      return send(200, { access_token: jwt(id), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'mock', user })
    }
    if (url.pathname.startsWith('/auth/v1/')) return send(200, {})
    // Stands in for web/api/verify-photo.ts (the e2e test routes the app's request here). The same checks as
    // photo_hunt_check/claim_photo_hunt, with Gemini replaced by "any photo matches".
    if (url.pathname === '/__verify-photo') {
      const me = players.find((p) => p.auth_id === subFrom(req))
      const drop = drops.find((d) => d.id === json.dropId && d.type === 'photo_hunt')
      const secret = secrets.find((x) => x.drop_id === json.dropId)
      if (!me) return send(403, { error: 'Join the game before claiming drops' })
      if (!drop || drop.status !== 'active' || (drop.expires_at && Date.parse(drop.expires_at) <= Date.now())) return send(400, { error: 'This hunt is over' })
      if (claims.some((c) => c.drop_id === drop.id && c.player_id === me.id)) return send(400, { error: 'You already found this one' })
      if (distance(json.lat, json.lng, secret.hunt_lat, secret.hunt_lng) > RADIUS_M) return send(400, { error: "This isn't the spot. Keep looking!" })
      if (!json.image) return send(200, { match: false, reason: 'Mock referee: no photo' })
      const found = claims.filter((c) => c.drop_id === drop.id).length
      const points = Math.max(1, Math.floor(drop.points / 2 ** found))
      claims.push({ id: randomUUID(), drop_id: drop.id, player_id: me.id, points, created_at: now() })
      if (found === 0) {
        Object.assign(drop, { lat: secret.hunt_lat, lng: secret.hunt_lng, building_num: secret.hunt_building_num, first_found_at: now() })
        drop.expires_at = new Date(Math.min(Date.now() + HUNT_WINDOW_MS, drop.expires_at ? Date.parse(drop.expires_at) : Infinity)).toISOString()
      }
      return send(200, { match: true, points, reason: 'Mock referee: same spot, twist done.' })
    }
    // supabase-js falls back to HTTP for broadcasts when the socket is down; there is nobody to relay to here.
    if (url.pathname === '/realtime/v1/api/broadcast') return send(202, {})

    const path = url.pathname.replace('/rest/v1/', '')
    const me = players.find((p) => p.auth_id === subFrom(req))
    if (path.startsWith('rpc/')) {
      const fn = rpc[path.slice(4)]
      if (!fn) return send(404, { message: `mock: no rpc ${path}` })
      const [status, data] = fn(json, me)
      return send(status, data)
    }
    if (req.method === 'POST' && path === 'players') {
      // Everyone is an admin in the mock so admin screens are testable.
      const p = { id: randomUUID(), auth_id: subFrom(req), ...json, color: PALETTE[players.length % PALETTE.length], is_admin: true, created_at: now() }
      players.push(p)
      return reply([p])
    }
    if (req.method === 'POST' && path === 'drops') {
      const d = { id: randomUUID(), status: 'active', points: 10, hint_photo_url: null, building_num: null, expires_at: null, created_at: now(), twist: null, search_radius_m: null, first_found_at: null, ...json }
      drops.push(d)
      secrets.push({ drop_id: d.id, claim_code: randomUUID().replaceAll('-', '') })
      return reply([d])
    }
    const tables = { players, drops, drop_secrets: secrets, player_scores: scores() }
    if (tables[path]) return reply(filterRows(tables[path], url.searchParams))
    send(404, { message: `mock: no route ${req.method} ${url.pathname}` })
  })

  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await startMockSupabase()
  console.log(`mock supabase on http://localhost:${MOCK_PORT}`)
}
