// Mini-game kinds (drops.game) and Quick Draw: seeded signal schedule, submit_reaction's checks, best-time scoring.
import { LAT, LNG, actor, check, createDb, finish, migrate, superuser } from './harness.mjs'

const db = await createDb()
await migrate(db)
const as = actor(db)
const su = superuser(db)
const admin = (q, p) => as('admin', { app_role: 'admin' }, q, p)
const insertDrop = (type, game) =>
  admin(`insert into drops (title, type, lat, lng, points, game) values ('d', $1, $2, $3, 30, $4) returning id, game`, [type, LAT, LNG, game])

// --- Which game a drop is
let r = await insertDrop('minigame', null)
check('a minigame drop without a game is a Shake-Off', r.rows?.[0]?.game === 'shake_off', r)
r = await insertDrop('checkin', 'quick_draw')
check('other drop types never carry a game', r.rows?.[0]?.game === null, r)
r = await insertDrop('minigame', 'darts')
check('unknown games are refused', /drops_game_check/.test(r.error ?? ''), r)
const game = (await insertDrop('minigame', 'quick_draw')).rows[0].id

for (const n of ['p1', 'p2', 'p3', 'p4', 'p5']) await as(n, {}, `insert into players (display_name) values ($1)`, [n])
const state = async (sub = 'p1') => (await as(sub, {}, `select get_game_state($1) as s`, [game])).rows[0].s
let s = await state()
check('state names the game', s.kind === 'quick_draw', s.kind)
check('settings come from the server', s.settings.rounds === 3 && s.settings.round_seconds === 10 && s.settings.game_seconds === 30 && s.settings.min_reaction_ms === 100, s.settings)
check('no schedule before a start', s.rounds.length === 0 && s.results.length === 0, s)

r = await as('p1', {}, `select * from claim_drop($1, $2, $3)`, [game, LAT, LNG])
check('claim_drop refuses it like any minigame', !!r.error, r)
for (const n of ['p1', 'p2', 'p3', 'p4']) await as(n, {}, `select join_game($1, $2, $3)`, [game, LAT, LNG])
r = await as('p1', {}, `select submit_reaction($1, 1, 250)`, [game])
check('cannot submit before the start', /hasn't started/.test(r.error ?? ''), r)

s = await state()
const rounds = s.rounds
const delays = rounds.map((x) => Date.parse(x.signal_at) - Date.parse(x.starts_at))
check('4th join schedules 3 rounds', rounds.length === 3 && s.game.started_at === rounds[0].starts_at, rounds)
check('rounds are 10 s apart', Date.parse(rounds[2].starts_at) - Date.parse(rounds[0].starts_at) === 20_000, rounds)
check('each signal comes 2-6 s into its round', delays.every((d) => d >= 2000 && d <= 6000), delays)
check('every caller sees the same schedule', JSON.stringify((await state('p3')).rounds) === JSON.stringify(rounds))

// Moves the game so that "now" is `ms` after round `round`'s signal (negative = before it).
const at = (round, ms) =>
  su(`update games set started_at = now() - make_interval(secs => $2 / 1000.0) where drop_id = $1`, [game, (round - 1) * 10_000 + delays[round - 1] + ms])
const react = (sub, round, ms) => as(sub, {}, `select submit_reaction($1, $2, $3) as r`, [game, round, ms])

await at(1, -1900)
check('a time reported long before the signal is refused', /No signal/.test((await react('p1', 1, 300)).error ?? ''))
r = await react('p2', 1, null)
check('a flick before the signal is a false start', r.rows?.[0]?.r?.false_start === true && r.rows[0].r.value === null, r)
await at(1, 200)
check('the server time must allow the reported time', /No signal/.test((await react('p4', 1, 1400)).error ?? ''))
r = await react('p1', 1, 250)
check('a valid reaction is stored', r.rows?.[0]?.r?.value === 250, r)
r = await react('p1', 1, 120)
check('the first result for a round is final', r.rows?.[0]?.r?.value === 250, r)
r = await react('p3', 1, 60)
check('under 100 ms is a false start', r.rows?.[0]?.r?.false_start === true, r)
check('impossible times are refused', /isn't possible/.test((await react('p4', 1, 5000)).error ?? '') && /isn't possible/.test((await react('p4', 1, -5)).error ?? ''))
check('rounds that don\'t exist are refused', /no round 4/.test((await react('p4', 4, 200)).error ?? ''))
check('a round that hasn\'t begun is refused', /Round 2 hasn't started/.test((await react('p4', 2, 200)).error ?? ''))
check('outsiders cannot submit', /not in this/.test((await react('p5', 1, 200)).error ?? ''))
check('shake counts are refused in a Quick Draw', /hasn't started/.test((await as('p1', {}, `select submit_shakes($1, 5)`, [game])).error ?? ''))
check('direct result writes blocked', !!(await as('p1', {}, `insert into game_results (drop_id, player_id, round, value) select $1, id, 2, 1 from players limit 1`, [game])).error)
await at(1, 4700) // max reaction 1.5 s + 3 s grace
r = await react('p4', 1, 300)
check('a round closes after its window plus grace', /Round 1 is over/.test(r.error ?? ''), r)

// Sides from the server; the "fast" side gets 200/220 ms best times, the other 300 ms and an all-false-start player.
const sides = { blue: [], white: [] }
for (const p of (await state()).players) sides[p.side].push(p.display_name)
const fast = sides.blue.includes('p1') ? 'blue' : 'white'
const slow = fast === 'blue' ? 'white' : 'blue'
await su(`delete from game_results where drop_id = $1`, [game])
const plan = { [sides[fast][0]]: [400, 200, 900], [sides[fast][1]]: [220, 260, 240], [sides[slow][0]]: [300, 350, 310], [sides[slow][1]]: [null, null, null] }
for (const round of [1, 2, 3]) {
  await at(round, 1000)
  for (const [sub, times] of Object.entries(plan)) await react(sub, round, times[round - 1])
}
s = await state()
check('every round result is in the state', s.results.length === 12, s.results.length)
check('cannot finish early', /isn't over/.test((await as('p1', {}, `select finish_game($1)`, [game])).error ?? ''))
await su(`update games set started_at = now() - interval '34 seconds' where drop_id = $1`, [game])
const fin = (await as('p2', {}, `select finish_game($1) as s`, [game])).rows?.[0]?.s
check(`lower average best time wins (${fast}: 210 ms vs 900 ms with the false starter at 1500)`, fin?.game?.winner_side === fast, fin?.game)
check('finish is idempotent', (await as('p3', {}, `select finish_game($1) as s`, [game])).rows?.[0]?.s?.game?.finished_at === fin?.game?.finished_at)
r = await as('p1', {}, `select p.display_name, c.points from claims c join players p on p.id = c.player_id where c.drop_id = $1 order by 1`, [game])
check('every winner gets the drop\'s points', JSON.stringify(r.rows.map((x) => x.display_name)) === JSON.stringify([...sides[fast]].sort()) && r.rows.every((x) => x.points === 30), r.rows)
check('no submits after the finish', /over/.test((await react('p1', 3, 200)).error ?? ''))

finish()
