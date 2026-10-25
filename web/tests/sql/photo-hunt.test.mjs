// Photo hunts: hidden spot, server-only claiming (after Gemini), halving points, reveal, and the 7-minute window.
import { LAT, LNG, M_PER_DEG_LAT, actor, check, createDb, finish, migrate, serviceRole, superuser } from './harness.mjs'

const db = await createDb()
await migrate(db)
const as = actor(db)
const server = serviceRole(db)
const su = superuser(db)
const admin = (q, p) => as('admin', { app_role: 'admin' }, q, p)
const SIG = 'uuid, uuid, double precision, double precision'

for (const n of ['p1', 'p2', 'p3', 'p4']) await as(n, {}, `insert into players (display_name) values ($1)`, [n])
const id = async (sub) => (await su(`select id from players where auth_id = $1`, [sub]))[0].id
const [p1, p2, p3, p4] = [await id('p1'), await id('p2'), await id('p3'), await id('p4')]
const hunt = async ({ points = 20, building = '0001000' } = {}) =>
  (await admin(`select (create_photo_hunt('Mystery', $1, $2, 'https://x/ref.jpg', ' with a thumbs up ', $3, $4)).id`, [LAT, LNG, points, building]))
    .rows[0].id
const claim = (dropId, playerId, lat = LAT, lng = LNG) => server(`select * from claim_photo_hunt($1, $2, $3, $4)`, [dropId, playerId, lat, lng])
const drop = async (dropId) => (await as('p1', {}, `select * from drops where id = $1`, [dropId])).rows[0]

// --- Creating
let r = await as('p1', {}, `select create_photo_hunt('x', $1, $2, 'https://x/ref.jpg', 'thumbs up')`, [LAT, LNG])
check('non-admin cannot create a hunt', /Only admins/.test(r.error ?? ''), r)
r = await admin(`select create_photo_hunt('x', $1, $2, 'https://x/ref.jpg', '   ')`, [LAT, LNG])
check('a hunt needs a twist', /twist/.test(r.error ?? ''), r)
r = await admin(`select create_photo_hunt('x', $1, $2, '', 'thumbs up')`, [LAT, LNG])
check('a hunt needs a reference photo', /reference photo/.test(r.error ?? ''), r)

const h = await hunt()
let d = await drop(h)
const offset = (await su(`select distance_m($1, $2, $3, $4) as m`, [d.lat, d.lng, LAT, LNG]))[0].m
check('players see a search circle near, but not on, the spot', d.search_radius_m === 125 && offset <= 125 * 0.75 + 0.5, { offset, d })
check('building and reveal time hidden until found', d.building_num === null && d.first_found_at === null, d)
check('twist trimmed', d.twist === 'with a thumbs up', d.twist)
check('players cannot read the exact spot', (await as('p1', {}, `select * from drop_secrets where drop_id = $1`, [h])).rows?.length === 0)
const secret = (await admin(`select hunt_lat, hunt_lng, hunt_building_num from drop_secrets where drop_id = $1`, [h])).rows[0]
check('admins can', secret?.hunt_lat === LAT && secret.hunt_lng === LNG && secret.hunt_building_num === '0001000', secret)

// --- Players can't skip the photo
r = await as('p1', {}, `select * from claim_drop($1, $2, $3)`, [h, LAT, LNG])
check('claim_drop refuses photo hunts (GPS)', /taking the photo/.test(r.error ?? ''), r)
const code = (await admin(`select claim_code from drop_secrets where drop_id = $1`, [h])).rows[0].claim_code
r = await as('p1', {}, `select * from claim_drop(p_drop_id => $1, p_code => $2)`, [h, code])
check('claim_drop refuses photo hunts (QR)', /taking the photo/.test(r.error ?? ''), r)
for (const fn of ['claim_photo_hunt', 'photo_hunt_check']) {
  r = await as('p1', {}, `select ${fn}($1, $2, $3, $4)`, [h, p1, LAT, LNG])
  check(`players cannot call ${fn}`, /permission denied/.test(r.error ?? ''), r)
}
check('the server can', (await su(`select has_function_privilege('service_role', 'claim_photo_hunt(${SIG})', 'execute') as ok`))[0].ok)
r = await as('p1', {}, `select current_player_id() as id`)
check('current_player_id() resolves the caller', r.rows?.[0]?.id === p1, r)

// --- Checks before Gemini
r = await server(`select photo_hunt_check($1, $2, $3, $4)`, [h, p1, LAT + 61 / M_PER_DEG_LAT, LNG])
check('61 m from the spot: not the spot, and no distance given', r.error === "This isn't the spot. Keep looking!", r)
r = await server(`select photo_hunt_check($1, $2, $3, $4)`, [h, p1, d.lat, d.lng])
check('standing at the circle center is not enough', offset <= 60 || /isn't the spot/.test(r.error ?? ''), r)
r = await server(`select photo_hunt_check($1, $2, $3, $4)`, [h, p1, LAT + 59 / M_PER_DEG_LAT, LNG])
check('59 m from the spot passes', !r.error, r)
r = await server(`select photo_hunt_check($1, $2, null, null)`, [h, p1])
check('no GPS rejected', /location/.test(r.error ?? ''), r)

// --- Finding
r = await claim(h, p1)
check('1st finder gets full points', r.rows?.[0]?.points === 20, r)
d = await drop(h)
const window = (await su(`select extract(epoch from expires_at - first_found_at) as s from drops where id = $1`, [h]))[0].s
check('first find reveals the exact spot and building', d.lat === LAT && d.lng === LNG && d.building_num === '0001000' && d.first_found_at !== null, d)
check('and closes the hunt 7 minutes later', Math.abs(window - 420) < 1, { window })
check('the drop stays active for later finders', d.status === 'active')
r = await claim(h, p1)
check('cannot find it twice', /already found/.test(r.error ?? ''), r)
check('2nd finder gets half', (await claim(h, p2)).rows?.[0]?.points === 10)
check('3rd finder gets a quarter', (await claim(h, p3)).rows?.[0]?.points === 5)
check('a later find keeps the original window', (await su(`select extract(epoch from expires_at - first_found_at) as s from drops where id = $1`, [h]))[0].s === window)

r = await as('p1', {}, `select display_name, points, claims from player_scores where claims > 0 order by points desc`)
check('leaderboard counts each claim’s own points', JSON.stringify(r.rows) === JSON.stringify([
  { display_name: 'p1', points: 20, claims: 1 },
  { display_name: 'p2', points: 10, claims: 1 },
  { display_name: 'p3', points: 5, claims: 1 },
]), r.rows)

await su(`update drops set expires_at = now() - interval '1 second' where id = $1`, [h])
check('no finds after the window', /over/.test((await claim(h, p4)).error ?? ''))

// --- Edge cases
const small = await hunt({ points: 3, building: null })
const pts = []
for (const p of [p1, p2, p3, p4]) pts.push((await claim(small, p)).rows?.[0]?.points)
check('points halve but never drop below 1', JSON.stringify(pts) === JSON.stringify([3, 1, 1, 1]), pts)
check('open-ground hunt reveals with no building', (await drop(small)).building_num === null)

const soon = await hunt()
await su(`update drops set expires_at = now() + interval '2 minutes' where id = $1`, [soon])
await claim(soon, p1)
const left = (await su(`select extract(epoch from expires_at - now()) as s from drops where id = $1`, [soon]))[0].s
check('an earlier expiry is kept, not extended to 7 minutes', left > 100 && left <= 120, { left })

// --- Other drops are unchanged
const checkin = (await admin(`insert into drops (title, type, lat, lng, points) values ('c', 'checkin', $1, $2, 15) returning id`, [LAT, LNG])).rows[0].id
r = await as('p1', {}, `select * from claim_drop($1, $2, $3)`, [checkin, LAT, LNG])
check('regular claims still record the drop’s points', r.rows?.[0]?.points === 15, r)
check('claim_photo_hunt refuses other drop types', /not found/.test((await claim(checkin, p2)).error ?? ''))

finish()
