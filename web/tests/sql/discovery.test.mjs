// Fog-of-war discovery: players record and read only their own areas; duplicates are ignored; rows are permanent.
import { actor, check, createDb, finish, migrate, superuser } from './harness.mjs'

const db = await createDb()
await migrate(db)
const as = actor(db)
const su = superuser(db)

for (const n of ['p1', 'p2']) await as(n, {}, `insert into players (display_name) values ($1)`, [n])
const id = async (sub) => (await su(`select id from players where auth_id = $1`, [sub]))[0].id
const [p1, p2] = [await id('p1'), await id('p2')]
const mine = async (sub) => (await as(sub, {}, `select player_id, hex_id from discovered_areas order by hex_id`)).rows

// --- discover_area
let r = await as('p1', {}, `select discover_area('3:-2') as added`)
check('first discovery returns true', r.rows?.[0].added === true, r)
r = await as('p1', {}, `select discover_area('3:-2') as added`)
check('duplicate is ignored and returns false', r.rows?.[0].added === false, r)
await as('p1', {}, `select discover_area('-14:7')`)
await as('p2', {}, `select discover_area('0:0')`)
check('one row per area, no duplicates', (await su(`select count(*)::int as n from discovered_areas where player_id = $1`, [p1]))[0].n === 2)

r = await as('ghost', {}, `select discover_area('1:1')`)
check('signed in but never joined: refused', /Join the game/.test(r.error ?? ''), r)
r = await as('p1', {}, `select discover_area('Old Main')`)
check('malformed hex id rejected', /check constraint/.test(r.error ?? ''), r)
r = await db.exec('reset role').then(() => db.exec(`set role anon`)).then(() => db.query(`select discover_area('1:1')`)).catch((e) => ({ error: e.message }))
await db.exec('reset role')
check('anon cannot call discover_area', /permission denied/.test(r.error ?? ''), r)

// --- Reading
let rows = await mine('p1')
check('players read their own areas', rows.length === 2 && rows.every((x) => x.player_id === p1), rows)
rows = await mine('p2')
check("and only their own (p2 can't see p1's)", rows.length === 1 && rows[0].player_id === p2 && rows[0].hex_id === '0:0', rows)

// --- Direct writes
r = await as('p2', {}, `insert into discovered_areas (player_id, hex_id) values ($1, '5:5')`, [p2])
check('direct insert of an own row is allowed', !r.error, r)
r = await as('p2', {}, `insert into discovered_areas (player_id, hex_id) values ($1, '6:6')`, [p1])
check("can't insert a row for someone else", /row-level security/.test(r.error ?? ''), r)
r = await as('p1', {}, `update discovered_areas set hex_id = '9:9' where player_id = $1`, [p1])
check("can't edit discoveries", /permission denied/.test(r.error ?? ''), r)
r = await as('p1', {}, `delete from discovered_areas where player_id = $1`, [p1])
check("can't delete discoveries", /permission denied/.test(r.error ?? ''), r)
check('p1 still has both areas', (await mine('p1')).length === 2)

// --- Columns: nothing that could locate a player
const cols = (await su(`select column_name from information_schema.columns where table_name = 'discovered_areas' order by column_name`)).map((c) => c.column_name)
check('only player_id and hex_id are stored', JSON.stringify(cols) === '["hex_id","player_id"]', cols)

// --- Deleting a player removes their areas
await su(`delete from players where id = $1`, [p2])
check("a deleted player's areas go with them", (await su(`select count(*)::int as n from discovered_areas where player_id = $1`, [p2]))[0].n === 0)

finish()
