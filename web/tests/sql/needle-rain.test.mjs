// Needle Rain: claim refusal, solo ghost, capped dodges, one payout, and an old Shake-Off still finishes on shakes.
import { scheduleRespectsCap, needleSchedule } from '../../src/game/needleRain.ts'
import { LAT, LNG, actor, check, createDb, finish, migrate, superuser } from './harness.mjs'

const RAIN = { game_seconds: 40, max_dodges_per_second: 4 }
check('storm stays inside the dodge cap for several seeds', ['alpha', 'bravo', 'charlie', 'round-seed', 'ghost-seed'].every((seed) => scheduleRespectsCap(seed, RAIN)))
check('two phones derive the same storm', JSON.stringify(needleSchedule('shared', RAIN)) === JSON.stringify(needleSchedule('shared', RAIN)))
check('a different seed is a different storm', JSON.stringify(needleSchedule('shared', RAIN)) !== JSON.stringify(needleSchedule('other', RAIN)))

const db = await createDb()
await migrate(db)
const as = actor(db)
const su = superuser(db)
const admin = (q, p) => as('admin', { app_role: 'admin' }, q, p)

for (const n of ['p1', 'p2', 'p3']) await as(n, {}, `insert into players (display_name) values ($1)`, [n])

const mk = async (kind, points = 17) =>
  (await admin(
    `insert into drops (title, type, game, lat, lng, points) values ('Rain', 'minigame', $1, $2, $3, $4) returning id`,
    [kind, LAT, LNG, points],
  )).rows[0].id

const state = async (drop, sub = 'p1') => (await as(sub, {}, `select get_game_state($1) as s`, [drop])).rows[0].s
const claimsOf = async (drop) => su(`select p.display_name, c.points from claims c join players p on p.id = c.player_id where c.drop_id = $1 order by 1`, [drop])

let r = await as('p1', {}, `select * from claim_drop($1, $2, $3)`, [await mk('needle_rain'), LAT, LNG])
check('claim_drop refuses a Needle Rain', /Needle Rain/.test(r.error ?? ''), r)
const qrDrop = await mk('needle_rain')
const code = (await su(`select claim_code from drop_secrets where drop_id = $1`, [qrDrop]))[0].claim_code
r = await as('p1', {}, `select * from claim_drop(p_drop_id => $1, p_code => $2)`, [qrDrop, code])
check('a Needle Rain QR cannot claim it either', /Needle Rain/.test(r.error ?? ''), r)

// --- Solo ghost: no points, drop stays open, record only moves up, cap rejects an inflated count.
const ghost = await mk('needle_rain', 21)
check('join in range', !(await as('p1', {}, `select join_game($1, $2, $3)`, [ghost, LAT, LNG])).error)
let s = await state(ghost)
check('lobby hides the live round seed and the private seed', s.game.started_at === null && s.game.round_seed === null && s.game.seed === undefined && typeof s.game.ghost_seed === 'string', s.game)
check('needle settings come from the server', s.settings.game_seconds === 40 && s.settings.max_dodges_per_second === 4 && s.settings.auto_start_players === 2, s.settings)
r = await as('p1', {}, `select submit_ghost($1, 10) as n`, [ghost])
check('ghost stores the practice count', r.rows?.[0]?.n === 10, r)
s = await state(ghost)
check('lobby names the record', s.game.ghost_dodges === 10 && s.game.ghost_name === 'p1', s.game)
check('a lower ghost does not replace the record', (await as('p1', {}, `select submit_ghost($1, 4) as n`, [ghost])).rows?.[0]?.n === 4)
s = await state(ghost)
check('record stays with the higher run', s.game.ghost_dodges === 10 && s.game.ghost_name === 'p1', s.game)
check('p2 joins and the short countdown is scheduled', !(await as('p2', {}, `select join_game($1, $2, $3)`, [ghost, LAT, LNG])).error)
s = await state(ghost)
const delay = (Date.parse(s.game.started_at) - Date.parse(s.server_now)) / 1000
check('second player schedules the round ~3 s out', delay > 2 && delay <= 3.5, { delay })
check('round seed is public once scheduled, and it is not the ghost seed', typeof s.game.round_seed === 'string' && s.game.round_seed !== s.game.ghost_seed && s.game.seed === undefined, s.game)
check('p2 takes the record with a higher practice', (await as('p2', {}, `select submit_ghost($1, 22) as n`, [ghost])).rows?.[0]?.n === 22)
s = await state(ghost)
check('record to beat is p2 · 22', s.game.ghost_dodges === 22 && s.game.ghost_name === 'p2', s.game)
check('a lower challenge leaves that record', (await as('p1', {}, `select submit_ghost($1, 11) as n`, [ghost])).rows?.[0]?.n === 11 && (await state(ghost)).game.ghost_name === 'p2')
r = await as('p1', {}, `select submit_ghost($1, 99999) as n`, [ghost])
check('inflated ghost is capped at one full round', r.rows?.[0]?.n === 160, r)
s = await state(ghost)
check('capped ghost becomes the record', s.game.ghost_dodges === 160 && s.game.ghost_name === 'p1', s.game)
check('ghost paid nothing and left the drop active', (await claimsOf(ghost)).length === 0 && (await su(`select status from drops where id = $1`, [ghost]))[0].status === 'active' && s.game.finished_at === null)

// --- Two players: cap, one payout, loser gets nothing.
const game = await mk('needle_rain', 17)
await as('p1', {}, `select join_game($1, $2, $3)`, [game, LAT, LNG])
await as('p2', {}, `select join_game($1, $2, $3)`, [game, LAT, LNG])
check('cannot submit dodges before the start', /hasn't started/.test((await as('p1', {}, `select submit_dodges($1, 5)`, [game])).error ?? ''))
await su(`update games set started_at = now() - interval '10 seconds' where drop_id = $1`, [game])
r = await as('p1', {}, `select submit_dodges($1, 100000) as n`, [game])
check('inflated dodge count capped to 4/s x 10 s = 40', r.rows?.[0]?.n === 40, r)
check('a lower dodge report never lowers the count', (await as('p1', {}, `select submit_dodges($1, 5) as n`, [game])).rows?.[0]?.n === 40)
check('the other player stores an honest count', (await as('p2', {}, `select submit_dodges($1, 8) as n`, [game])).rows?.[0]?.n === 8)
check('cannot finish early', /isn't over/.test((await as('p1', {}, `select finish_game($1)`, [game])).error ?? ''))
await su(`update games set started_at = now() - interval '44 seconds' where drop_id = $1`, [game])
check('no dodges after the grace period', /over/.test((await as('p1', {}, `select submit_dodges($1, 50)`, [game])).error ?? ''))
const fin = (await as('p2', {}, `select finish_game($1) as s`, [game])).rows?.[0]?.s
check('higher dodge count wins', fin?.game?.winner_id && fin.players.find((p) => p.player_id === fin.game.winner_id)?.display_name === 'p1', fin?.game)
check('finish is idempotent', (await as('p1', {}, `select finish_game($1) as s`, [game])).rows?.[0]?.s?.game?.finished_at === fin?.game?.finished_at)
let claims = await claimsOf(game)
check('winner is paid the drop points once', JSON.stringify(claims) === JSON.stringify([{ display_name: 'p1', points: 17 }]), claims)
check('drop marked claimed', (await su(`select status from drops where id = $1`, [game]))[0].status === 'claimed')

// --- Last person standing beats a higher frozen count.
const alive = await mk('needle_rain', 9)
await as('p1', {}, `select join_game($1, $2, $3)`, [alive, LAT, LNG])
await as('p2', {}, `select join_game($1, $2, $3)`, [alive, LAT, LNG])
await su(`update games set started_at = now() - interval '10 seconds' where drop_id = $1`, [alive])
check('a hit stores the count and eliminates', (await as('p1', {}, `select submit_dodges($1, 30, true) as n`, [alive])).rows?.[0]?.n === 30)
check('an eliminated count stays frozen', (await as('p1', {}, `select submit_dodges($1, 100, false) as n`, [alive])).rows?.[0]?.n === 30)
check('the survivor has fewer dodges', (await as('p2', {}, `select submit_dodges($1, 4, false) as n`, [alive])).rows?.[0]?.n === 4)
await su(`update games set started_at = now() - interval '44 seconds' where drop_id = $1`, [alive])
const aliveFin = (await as('p1', {}, `select finish_game($1) as s`, [alive])).rows?.[0]?.s
check('last person standing wins', aliveFin?.players.find((p) => p.player_id === aliveFin.game.winner_id)?.display_name === 'p2', aliveFin?.game)
claims = await claimsOf(alive)
check('only the survivor is paid', JSON.stringify(claims) === JSON.stringify([{ display_name: 'p2', points: 9 }]), claims)

// --- Exact tie still pays exactly one player.
const tie = await mk('needle_rain', 5)
await as('p1', {}, `select join_game($1, $2, $3)`, [tie, LAT, LNG])
await as('p2', {}, `select join_game($1, $2, $3)`, [tie, LAT, LNG])
await su(`update games set started_at = now() - interval '44 seconds' where drop_id = $1`, [tie])
await as('p1', {}, `select submit_dodges($1, 10)`, [tie])
await as('p2', {}, `select submit_dodges($1, 10)`, [tie])
const tieFin = (await as('p1', {}, `select finish_game($1) as s`, [tie])).rows?.[0]?.s
const tieClaims = await claimsOf(tie)
check('a dodge tie pays one of the two', tieClaims.length === 1 && ['p1', 'p2'].includes(tieClaims[0].display_name) && tieClaims[0].points === 5, tieClaims)
check('the tie picks a stable winner', (await as('p2', {}, `select finish_game($1) as s`, [tie])).rows?.[0]?.s?.game?.winner_id === tieFin?.game?.winner_id)

// --- A Needle Rain needs two players; a lone one can still practice (covered above) but not be started.
const solo = await mk('needle_rain')
await as('p1', {}, `select join_game($1, $2, $3)`, [solo, LAT, LNG])
check('admin cannot start a Needle Rain with 1 player', /at least 2/.test((await admin(`select start_game($1)`, [solo])).error ?? ''))
check('non-admin cannot start one', /admins/.test((await as('p1', {}, `select start_game($1)`, [solo])).error ?? ''))

// --- An old Shake-Off still finishes on shakes, not dodges.
const shake = await mk('shake_off', 30)
check('this row is a Shake-Off', (await su(`select game from drops where id = $1`, [shake]))[0].game === 'shake_off')
await as('p1', {}, `select join_game($1, $2, $3)`, [shake, LAT, LNG])
await as('p2', {}, `select join_game($1, $2, $3)`, [shake, LAT, LNG])
check('two players do not auto-start a Shake-Off', (await state(shake)).game.started_at === null)
check('admin can still start a Shake-Off at 2', !(await admin(`select start_game($1)`, [shake])).error)
await su(`update games set started_at = now() - interval '10 seconds' where drop_id = $1`, [shake])
s = await state(shake)
check('Shake-Off settings are unchanged', s.settings.game_seconds === 15 && s.settings.max_shakes_per_second === 8, s.settings)
const sideOf = Object.fromEntries(s.players.map((p) => [p.display_name, p.side]))
await as('p1', {}, `select submit_shakes($1, 40)`, [shake])
await as('p2', {}, `select submit_shakes($1, 10)`, [shake])
await su(`update games set started_at = now() - interval '20 seconds' where drop_id = $1`, [shake])
const shakeFin = (await as('p2', {}, `select finish_game($1) as s`, [shake])).rows?.[0]?.s
check('higher shakes still win the Shake-Off', shakeFin?.game?.winner_side === sideOf.p1 && shakeFin.game.winner_id == null, shakeFin?.game)
claims = await claimsOf(shake)
check('Shake-Off still pays that side the drop points', JSON.stringify(claims) === JSON.stringify([{ display_name: 'p1', points: 30 }]), claims)
check('Shake-Off dodges stay unused', (await su(`select bool_and(dodges = 0 and not eliminated) as ok from game_players where drop_id = $1`, [shake]))[0].ok === true)

finish()
