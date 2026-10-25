// Point to the Landmark: landmark picks, true bearings from the drop, submit_heading's checks, error scoring.
import { LAT, LNG, actor, check, createDb, finish, migrate, superuser } from './harness.mjs'

const db = await createDb()
await migrate(db)
const as = actor(db)
const su = superuser(db)
const admin = (q, p) => as('admin', { app_role: 'admin' }, q, p)
const one = async (q, p) => Object.values((await su(q, p))[0])[0]

// --- Geometry helpers
check('due north is 0°', Math.abs(await one(`select bearing_deg(40.79, -77.86, 40.80, -77.86)`)) < 1e-9)
check('due east is ~90°', Math.abs((await one(`select bearing_deg(40.79, -77.87, 40.79, -77.86)`)) - 90) < 0.01)
check('due south is 180°', Math.abs((await one(`select bearing_deg(40.80, -77.86, 40.79, -77.86)`)) - 180) < 1e-9)
check('due west is ~270°', Math.abs((await one(`select bearing_deg(40.79, -77.86, 40.79, -77.87)`)) - 270) < 0.01)
const diffs = await su(`select angle_diff(350, 10) a, angle_diff(10, 350) b, angle_diff(0, 180) c, angle_diff(90, 90) d, angle_diff(359.5, 0.5) e`)
check('angular error wraps around north', JSON.stringify(Object.values(diffs[0])) === JSON.stringify([20, 20, 180, 0, 1]), diffs[0])

// --- The game
const game = (await admin(`insert into drops (title, type, lat, lng, points, game) values ('Lawn', 'minigame', $1, $2, 40, 'landmark') returning id`, [LAT, LNG])).rows[0].id
for (const n of ['p1', 'p2', 'p3', 'p4', 'p5']) await as(n, {}, `insert into players (display_name) values ($1)`, [n])
const state = async (sub = 'p1') => (await as(sub, {}, `select get_game_state($1) as s`, [game])).rows[0].s
let s = await state()
check('state names the game', s.kind === 'landmark', s.kind)
check('settings come from the server', s.settings.rounds === 3 && s.settings.point_seconds === 8 && s.settings.round_seconds === 14 && s.settings.steady_ms === 1000, s.settings)
const wipe = await as('p1', {}, `delete from campus_landmarks returning 1`)
check('players can read the landmark list, not change it', (await as('p1', {}, `select count(*)::int as n from campus_landmarks`)).rows[0].n >= 10 && (!!wipe.error || wipe.rows.length === 0), wipe)

for (const n of ['p1', 'p2', 'p3', 'p4']) await as(n, {}, `select join_game($1, $2, $3)`, [game, LAT, LNG])
s = await state()
const rounds = s.rounds
check('4th join schedules 3 rounds, 14 s apart', rounds.length === 3 && Date.parse(rounds[2].starts_at) - Date.parse(rounds[0].starts_at) === 28_000, rounds)
check('a different landmark each round', new Set(rounds.map((r) => r.landmark.num)).size === 3, rounds.map((r) => r.landmark.name))
const far = await su(
  `select r->'landmark'->>'name' as name, distance_m($1, $2, (r->'landmark'->>'lat')::float8, (r->'landmark'->>'lng')::float8) as m from jsonb_array_elements($3::jsonb) r`,
  [LAT, LNG, JSON.stringify(rounds)],
)
check('every landmark is at least 200 m from the drop', far.every((x) => x.m >= 200), far)
const expected = await su(
  `select bearing_deg($1, $2, (r->'landmark'->>'lat')::float8, (r->'landmark'->>'lng')::float8) as b from jsonb_array_elements($3::jsonb) r`,
  [LAT, LNG, JSON.stringify(rounds)],
)
check('bearings are measured from the drop', rounds.every((r, i) => Math.abs(r.bearing - expected[i].b) < 1e-9), { rounds, expected })
check('every caller sees the same rounds', JSON.stringify((await state('p3')).rounds) === JSON.stringify(rounds))

const heading = (sub, round, h) => as(sub, {}, `select submit_heading($1, $2, $3) as r`, [game, round, h])
check('cannot point before the start', /hasn't started/.test((await heading('p1', 1, 10)).error ?? ''))
// Moves the game so that "now" is `ms` into round `round`.
const at = (round, ms) => su(`update games set started_at = now() - make_interval(secs => $2 / 1000.0) where drop_id = $1`, [game, (round - 1) * 14_000 + ms])
const b1 = rounds[0].bearing

await at(1, 3000)
check('headings outside 0..360 are refused', /0 up to 360/.test((await heading('p1', 1, 360)).error ?? '') && /0 up to 360/.test((await heading('p1', 1, -1)).error ?? ''))
check('NaN is refused', /0 up to 360/.test((await heading('p1', 1, 'NaN')).error ?? ''))
let r = await heading('p1', 1, (b1 + 10) % 360)
check('the server scores the error from the true bearing', Math.abs(r.rows?.[0]?.r?.value - 10) < 1e-6 && Math.abs(r.rows[0].r.heading - (b1 + 10) % 360) < 1e-9, r)
r = await heading('p1', 1, b1)
check('the first heading for a round is final', Math.abs(r.rows?.[0]?.r?.value - 10) < 1e-6, r)
r = await heading('p2', 1, (b1 + 190) % 360)
check('error wraps the short way round (190° off = 170°)', Math.abs(r.rows?.[0]?.r?.value - 170) < 1e-6, r)
check('rounds that don\'t exist are refused', /no round 4/.test((await heading('p3', 4, 0)).error ?? ''))
check('a round that hasn\'t begun is refused', /Round 2 hasn't started/.test((await heading('p3', 2, 0)).error ?? ''))
check('outsiders cannot point', /not in this/.test((await heading('p5', 1, 0)).error ?? ''))
check('other games\' submissions are refused', /hasn't started/.test((await as('p3', {}, `select submit_reaction($1, 1, 200)`, [game])).error ?? '') && /hasn't started/.test((await as('p3', {}, `select submit_shakes($1, 5)`, [game])).error ?? ''))
check('direct result writes blocked', !!(await as('p1', {}, `insert into game_results (drop_id, player_id, round, value) select $1, id, 2, 0 from players limit 1`, [game])).error)
await at(1, 11_500) // 8 s to point + 3 s grace
check('a round closes after pointing time plus grace', /Round 1 is over/.test((await heading('p3', 1, 0)).error ?? ''))

// Sides from the server: one side points within a few degrees; the other has a 30° pointer and one who never points.
const sides = { blue: [], white: [] }
for (const p of (await state()).players) sides[p.side].push(p.display_name)
const good = sides.blue.includes('p1') ? 'blue' : 'white'
const bad = good === 'blue' ? 'white' : 'blue'
await su(`delete from game_results where drop_id = $1`, [game])
const offBy = { [sides[good][0]]: [3, 5, 2], [sides[good][1]]: [8, 12, 6], [sides[bad][0]]: [30, 30, 30] }
for (const round of [1, 2, 3]) {
  await at(round, 4000)
  for (const [sub, errors] of Object.entries(offBy)) await heading(sub, round, (rounds[round - 1].bearing + errors[round - 1]) % 360)
}
s = await state()
check('every heading is in the state', s.results.length === 9 && s.results.every((x) => x.heading !== null), s.results.length)
check('cannot finish early', /isn't over/.test((await as('p1', {}, `select finish_game($1)`, [game])).error ?? ''))
await su(`update games set started_at = now() - interval '46 seconds' where drop_id = $1`, [game])
const fin = (await as('p2', {}, `select finish_game($1) as s`, [game])).rows?.[0]?.s
check(`lower average error wins (${good}: 6° vs 105° with a 180° no-show)`, fin?.game?.winner_side === good, fin?.game)
r = await as('p1', {}, `select p.display_name, c.points from claims c join players p on p.id = c.player_id where c.drop_id = $1 order by 1`, [game])
check('every winner gets the drop\'s points', JSON.stringify(r.rows.map((x) => x.display_name)) === JSON.stringify([...sides[good]].sort()) && r.rows.every((x) => x.points === 40), r.rows)

// A drop close to most landmarks still gets 3 rounds, all far enough away.
const crowded = (await admin(`insert into drops (title, type, lat, lng, game) values ('HUB', 'minigame', 40.798261, -77.861197, 'landmark') returning id`)).rows[0].id
for (const n of ['p1', 'p2']) await as(n, {}, `select join_game($1, $2, $3)`, [crowded, 40.798261, -77.861197])
await admin(`select start_game($1)`, [crowded])
const near = (await as('p1', {}, `select get_game_state($1) as s`, [crowded])).rows[0].s.rounds
check('the drop\'s own building is never the landmark', near.length === 3 && near.every((x) => x.landmark.num !== '0005000'), near.map((x) => x.landmark.name))

finish()
