// Today's behavior with every migration applied: joining, RLS, claiming, QR codes, scores, and Shake-Off.
import { LAT, LNG, M_PER_DEG_LAT, actor, check, createDb, finish, migrate, superuser } from './harness.mjs'

const db = await createDb()
await migrate(db)
const as = actor(db)
const su = superuser(db)
const admin = (q, p) => as('admin', { app_role: 'admin' }, q, p)
const mkDrop = async (type, { building = null, points = 25, lat = LAT, lng = LNG, expired = false } = {}) =>
  (await admin(
    `insert into drops (title, type, lat, lng, points, building_num, expires_at)
     values ('d', $1, $2, $3, $4, $5, case when $6 then now() - interval '1 minute' end) returning id`,
    [type, lat, lng, points, building, expired],
  )).rows[0].id

// --- Schema shape
check('no teams table', (await su(`select to_regclass('public.teams') as t`))[0].t === null)
check('no building_control table', (await su(`select to_regclass('public.building_control') as t`))[0].t === null)
check('no team_id columns', (await su(`select count(*)::int as n from information_schema.columns where table_schema = 'public' and column_name = 'team_id'`))[0].n === 0)
const scoreCols = (await su(`select column_name from information_schema.columns where table_name = 'player_scores' order by ordinal_position`)).map((r) => r.column_name)
check('player_scores columns', JSON.stringify(scoreCols) === JSON.stringify(['player_id', 'display_name', 'color', 'points', 'claims']), scoreCols)

// --- Players
for (const n of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']) await as(n, {}, `insert into players (display_name) values ($1)`, [n])
let r = await as('p1', {}, `select auth_id, color, is_admin from players where display_name = 'p1'`)
check('join with just a name: auth_id from JWT, color assigned, not admin', r.rows?.[0]?.auth_id === 'p1' && /^#[0-9a-f]{6}$/.test(r.rows[0].color) && r.rows[0].is_admin === false, r)
const colors = (await su(`select color from players`)).map((x) => x.color)
check('first players get distinct colors', new Set(colors).size === colors.length, colors)
check('cannot spoof auth_id', !!(await as('x', {}, `insert into players (display_name, auth_id) values ('x', 'p1')`)).error)
check('cannot choose own color', !!(await as('x', {}, `insert into players (display_name, color) values ('x', '#000000')`)).error)
check('cannot self-grant admin', !!(await as('x', {}, `insert into players (display_name, is_admin) values ('x', true)`)).error)
check("cannot rename someone else", (await as('p2', {}, `update players set display_name = 'hacked' where auth_id = 'p1' returning id`)).rows?.length === 0)

// --- Drops and admin rules
check('non-admin cannot insert drops', !!(await as('p1', {}, `insert into drops (title, type, lat, lng) values ('x', 'checkin', 0, 0)`)).error)
check('Auth0 admin claim can insert drops', !!(await mkDrop('checkin')))
await su(`update players set is_admin = true where auth_id = 'p6'`)
check('players.is_admin can insert drops', !!(await as('p6', {}, `insert into drops (title, type, lat, lng) values ('x', 'checkin', $1, $2) returning id`, [LAT, LNG])).rows)
await su(`update players set is_admin = false where auth_id = 'p6'`)

// --- Imported event drops (scripts/seed-event-drops.mjs)
const eventDrop = (source) =>
  admin(
    `insert into drops (title, type, lat, lng, subtitle, starts_at, expires_at, source_id)
     values ('Haunted House', 'checkin', $1, $2, 'Forensic Science Club', now() + interval '1 hour', now() + interval '3 hours', $3) returning id`,
    [LAT, LNG, source],
  )
const imported = (await eventDrop('discover:1')).rows?.[0]?.id
check('admin can insert an event drop with subtitle, start time and source', !!imported)
r = await as('p1', {}, `select subtitle, starts_at < expires_at as ordered, source_id from drops where id = $1`, [imported])
check('players read the subtitle and start time', r.rows?.[0]?.subtitle === 'Forensic Science Club' && r.rows[0].ordered && r.rows[0].source_id === 'discover:1', r)
check('the same event cannot be imported twice', /unique|duplicate/.test((await eventDrop('discover:1')).error ?? ''))
check('drops made in /admin have no source', (await su(`select count(*)::int as n from drops where source_id is null`))[0].n >= 2)
check('players cannot clear imported drops', (await as('p1', {}, `delete from drops where source_id is not null returning id`)).rows?.length === 0)
await admin(`delete from drops where source_id like 'discover:%'`)
check('clearing imports leaves admin-made drops', (await su(`select count(*)::int as n from drops where source_id is not null`))[0].n === 0 && (await su(`select count(*)::int as n from drops`))[0].n >= 2)

// --- Claiming
check('claim_radius_m() = 60', (await as('p1', {}, `select claim_radius_m() as m`)).rows[0].m === 60)
const plain = await mkDrop('checkin', { building: '0001000' })
check('direct claim insert blocked', !!(await as('p1', {}, `insert into claims (drop_id, player_id) select $1, id from players limit 1`, [plain])).error)
r = await as('p1', {}, `select * from claim_drop($1, $2, $3)`, [plain, LAT + 61 / M_PER_DEG_LAT, LNG])
check('61 m away rejected', /closer/.test(r.error ?? ''), r)
r = await as('p1', {}, `select * from claim_drop($1)`, [plain])
check('no GPS and no code rejected', /QR/.test(r.error ?? ''), r)
r = await as('p1', {}, `select * from claim_drop($1, $2, $3)`, [plain, LAT + 59 / M_PER_DEG_LAT, LNG])
check('59 m away accepted', !!r.rows?.[0]?.id, r)
check('drop marked claimed', (await su(`select status from drops where id = $1`, [plain]))[0].status === 'claimed')
r = await as('p2', {}, `select * from claim_drop($1, $2, $3)`, [plain, LAT, LNG])
check('second claim rejected', /no longer available/.test(r.error ?? ''), r)
check('building_num kept on the drop', (await su(`select building_num from drops where id = $1`, [plain]))[0].building_num === '0001000')
r = await as('p2', {}, `select * from claim_drop($1, $2, $3)`, [await mkDrop('checkin', { expired: true }), LAT, LNG])
check('expired drop rejected', /no longer available/.test(r.error ?? ''), r)
r = await as('nobody', {}, `select * from claim_drop($1, $2, $3)`, [await mkDrop('checkin'), LAT, LNG])
check('claim before joining rejected', /Join the game/.test(r.error ?? ''), r)

// --- QR codes
const qrDrop = await mkDrop('checkin', { lat: LAT + 0.02 })
const code = (await admin(`select claim_code from drop_secrets where drop_id = $1`, [qrDrop])).rows[0]?.claim_code
check('every drop gets a 32-char claim code', code?.length === 32, code)
check('players cannot read claim codes', (await as('p2', {}, `select * from drop_secrets`)).rows?.length === 0)
r = await as('p2', {}, `select * from claim_drop(p_drop_id => $1, p_code => 'wrong')`, [qrDrop])
check('wrong QR code rejected', /match/.test(r.error ?? ''), r)
r = await as('p2', {}, `select * from claim_drop(p_drop_id => $1, p_code => $2)`, [qrDrop, code])
check('QR code claims from any distance', !!r.rows?.[0]?.id, r)

// --- Scores
r = await as('p1', {}, `select display_name, points, claims from player_scores where points > 0 order by display_name`)
check('player_scores sums points', JSON.stringify(r.rows) === JSON.stringify([{ display_name: 'p1', points: 25, claims: 1 }, { display_name: 'p2', points: 25, claims: 1 }]), r.rows)

// --- Shake-Off
const game = await mkDrop('minigame', { building: '0005000', points: 30 })
r = await as('p1', {}, `select * from claim_drop($1, $2, $3)`, [game, LAT, LNG])
check('claim_drop refuses minigame drops', /Shake-Off/.test(r.error ?? ''), r)
r = await as('p1', {}, `select join_game($1, $2, $3)`, [game, LAT + 0.01, LNG])
check('joining requires range', /closer/.test(r.error ?? ''), r)
check('join in range', !(await as('p1', {}, `select join_game($1, $2, $3)`, [game, LAT, LNG])).error)
check('rejoin is a no-op', !(await as('p1', {}, `select join_game($1, $2, $3)`, [game, LAT, LNG])).error)
const gameCode = (await su(`select claim_code from drop_secrets where drop_id = $1`, [game]))[0].claim_code
check('join by QR from anywhere', !(await as('p2', {}, `select join_game(p_drop_id => $1, p_code => $2)`, [game, gameCode])).error)

const state = async (sub = 'p1') => (await as(sub, {}, `select get_game_state($1) as s`, [game])).rows[0].s
let s = await state()
check('lobby: no start, no sides, seed hidden', s.game.started_at === null && s.players.every((p) => p.side === null) && s.game.seed === undefined, s)
check('settings come from the server', s.settings.game_seconds === 15 && s.settings.max_shakes_per_second === 8, s.settings)
check('non-admin cannot start', /admins/.test((await as('p1', {}, `select start_game($1)`, [game])).error ?? ''))
check('cannot submit before start', /hasn't started/.test((await as('p1', {}, `select submit_shakes($1, 5)`, [game])).error ?? ''))

await as('p3', {}, `select join_game($1, $2, $3)`, [game, LAT, LNG])
await as('p4', {}, `select join_game($1, $2, $3)`, [game, LAT, LNG])
s = await state()
const autoDelay = (Date.parse(s.game.started_at) - Date.parse(s.server_now)) / 1000
check('4th join schedules start ~15 s out', autoDelay > 14 && autoDelay <= 15.5, { autoDelay })
check('5th player can join during the countdown', !(await as('p5', {}, `select join_game($1, $2, $3)`, [game, LAT, LNG])).error)
await admin(`select start_game($1)`, [game])
s = await state()
const adminDelay = (Date.parse(s.game.started_at) - Date.parse(s.server_now)) / 1000
check('admin start pulls it in to ~5 s', adminDelay > 4 && adminDelay <= 5.5, { adminDelay })

await su(`update games set started_at = now() - interval '6 seconds' where drop_id = $1`, [game])
check('no joining after start', /already started/.test((await as('p6', {}, `select join_game($1, $2, $3)`, [game, LAT, LNG])).error ?? ''))
s = await state()
const sides = s.players.map((p) => p.side)
const blues = sides.filter((x) => x === 'blue').length
check('5 players split 3/2', blues + sides.filter((x) => x === 'white').length === 5 && Math.abs(blues - (5 - blues)) === 1, sides)
check('every caller sees the same sides', JSON.stringify((await state('p4')).players.map((p) => p.side)) === JSON.stringify(sides))
r = await as('p1', {}, `select submit_shakes($1, 1000) as n`, [game])
check('faked count capped to 8/s x 6 s = 48', r.rows?.[0]?.n === 48, r)
check('a lower report never lowers the count', (await as('p1', {}, `select submit_shakes($1, 5) as n`, [game])).rows?.[0]?.n === 48)
check('outsider cannot submit', /not in this/.test((await as('p6', {}, `select submit_shakes($1, 5)`, [game])).error ?? ''))
check('cannot finish early', /isn't over/.test((await as('p1', {}, `select finish_game($1)`, [game])).error ?? ''))

// Smaller side averages more per player (2 x 60) than the bigger side (3 x 45) despite a lower total.
const bySide = { blue: [], white: [] }
for (const p of s.players) bySide[p.side].push(p.display_name)
const small = bySide.blue.length < bySide.white.length ? 'blue' : 'white'
const big = small === 'blue' ? 'white' : 'blue'
await su(`update games set started_at = now() - interval '15 seconds' where drop_id = $1`, [game])
for (const n of bySide[small]) await as(n, {}, `select submit_shakes($1, 60)`, [game])
for (const n of bySide[big]) await as(n, {}, `select submit_shakes($1, 45)`, [game])
await su(`update game_players set shakes = 45 where player_id = (select id from players where display_name = $1)`, [bySide[big][0]])
await su(`update games set started_at = now() - interval '19 seconds' where drop_id = $1`, [game])
check('no submits after the grace period', /over/.test((await as(bySide[small][0], {}, `select submit_shakes($1, 70)`, [game])).error ?? ''))
const fin = (await as('p2', {}, `select finish_game($1) as s`, [game])).rows?.[0]?.s
check(`higher per-player average wins (${small})`, fin?.game?.winner_side === small, fin?.game)
check('finish is idempotent', (await as('p3', {}, `select finish_game($1) as s`, [game])).rows?.[0]?.s?.game?.finished_at === fin?.game?.finished_at)
r = await as('p1', {}, `select p.display_name from claims c join players p on p.id = c.player_id where c.drop_id = $1 order by 1`, [game])
check('every winner gets a claim, losers none', JSON.stringify(r.rows.map((x) => x.display_name)) === JSON.stringify([...bySide[small]].sort()), r.rows)
check('drop marked claimed after the game', (await su(`select status from drops where id = $1`, [game]))[0].status === 'claimed')
check('direct game_players writes blocked', !!(await as('p1', {}, `insert into game_players (drop_id, player_id) select $1, id from players limit 1`, [game])).error)
r = await as('p1', {}, `update games set winner_side = 'blue' where drop_id = $1 returning 1`, [game])
check('direct games writes blocked', !!r.error || r.rows?.length === 0, r)

const tie = await mkDrop('minigame')
for (const n of ['p1', 'p2']) await as(n, {}, `select join_game($1, $2, $3)`, [tie, LAT, LNG])
check('admin can start with 2 players', !(await admin(`select start_game($1)`, [tie])).error)
await su(`update games set started_at = now() - interval '20 seconds' where drop_id = $1`, [tie])
r = await as('p1', {}, `select finish_game($1) as s`, [tie])
check('a 0-0 tie still yields one winner', ['blue', 'white'].includes(r.rows?.[0]?.s?.game?.winner_side), r)
const solo = await mkDrop('minigame')
await as('p1', {}, `select join_game($1, $2, $3)`, [solo, LAT, LNG])
check('admin cannot start with 1 player', /at least 2/.test((await admin(`select start_game($1)`, [solo])).error ?? ''))

finish()
