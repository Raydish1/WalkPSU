// In-memory stand-in for the Supabase REST/auth/RPC endpoints the app uses, for UI tests without a real project.
// It mirrors the SQL rules closely enough to drive the screens (60 m claim radius, QR codes, Shake-Off timing and
// caps) but it is not the source of truth: tests/sql checks the real functions. No Realtime: the app's refresh() and
// polling fallbacks keep screens current, exactly as on flaky venue Wi-Fi.
//
//   node tests/mock/supabase.mjs            # serves on :54321
//   VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY=mock npm run dev
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

export const MOCK_PORT = 54321
export const OLD_MAIN_LAWN = { lat: 40.7982, lng: -77.8599 }
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
  const drop = (id, title, type, lat, lng, points, building_num) =>
    ({ id, title, type, lat, lng, points, status: 'active', hint_photo_url: null, building_num, created_by: null, created_at: now(), expires_at: null })
  const drops = [
    drop('center-drop', 'Old Main lawn', 'checkin', OLD_MAIN_LAWN.lat, OLD_MAIN_LAWN.lng, 15, null),
    // ~30 m east of the lawn drop, at the HUB (so the map highlights building 0005000).
    drop('game-drop', 'HUB Shake-Off', 'minigame', OLD_MAIN_LAWN.lat, OLD_MAIN_LAWN.lng + 30 / (111_195 * Math.cos(rad(OLD_MAIN_LAWN.lat))), 30, '0005000'),
  ]
  return {
    players,
    drops,
    claims: [],
    secrets: drops.map((d) => ({ drop_id: d.id, claim_code: `${d.id}-code` })),
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
        points: claims.filter((c) => c.player_id === p.id).reduce((sum, c) => sum + drops.find((d) => d.id === c.drop_id).points, 0),
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
      if (!drop || drop.status !== 'active') return [400, { message: 'This drop is no longer available' }]
      if (!proofOk(json, drop)) return [400, { message: json.p_code != null ? "That QR code doesn't match this drop" : 'Get closer to claim this drop' }]
      drop.status = 'claimed'
      const claim = { id: randomUUID(), drop_id: drop.id, player_id: me.id, created_at: now() }
      claims.push(claim)
      return [200, claim]
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
        for (const gp of gamePlayers) if (sides.get(gp.player_id) === g.winner_side) claims.push({ id: randomUUID(), drop_id: json.p_drop_id, player_id: gp.player_id, created_at: g.finished_at })
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
      const d = { id: randomUUID(), status: 'active', points: 10, hint_photo_url: null, building_num: null, expires_at: null, created_at: now(), ...json }
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
