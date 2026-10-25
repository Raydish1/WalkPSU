// AI event search rate limit: 10 searches per 10 minutes per player, counters only, no direct table access.
import { actor, check, createDb, finish, migrate, superuser } from './harness.mjs'

const db = await createDb()
await migrate(db)
const as = actor(db)
const su = superuser(db)

for (const n of ['p1', 'p2']) await as(n, {}, `insert into players (display_name) values ($1)`, [n])
const take = async (sub) => (await as(sub, {}, `select use_search_quota() as ok`)).rows?.[0].ok

const firstTen = []
for (let i = 0; i < 10; i++) firstTen.push(await take('p1'))
check('10 searches allowed', firstTen.every(Boolean), firstTen)
check('the 11th is refused', (await take('p1')) === false)
check('another player has their own allowance', (await take('p2')) === true)

await su(`update search_quota set window_start = now() - interval '11 minutes' where player_id = (select id from players where auth_id = 'p1')`)
check('the allowance resets after 10 minutes', (await take('p1')) === true)
check('and counts from 1 again', (await su(`select used from search_quota where player_id = (select id from players where auth_id = 'p1')`))[0].used === 1)

let r = await as('ghost', {}, `select use_search_quota()`)
check('must have joined', /Join the game/.test(r.error ?? ''), r)
r = await as('p1', {}, `select * from search_quota`)
check("players can't read the counters", /permission denied/.test(r.error ?? ''), r)
r = await as('p1', {}, `update search_quota set used = 0`)
check("or reset them", /permission denied/.test(r.error ?? ''), r)
r = await db.exec('reset role').then(() => db.exec('set role anon')).then(() => db.query(`select use_search_quota()`)).catch((e) => ({ error: e.message }))
await db.exec('reset role')
check('anon can’t search', /permission denied/.test(r.error ?? ''), r)

const cols = (await su(`select column_name from information_schema.columns where table_name = 'search_quota' order by column_name`)).map((c) => c.column_name)
check('stores only a counter (no query text)', JSON.stringify(cols) === '["player_id","used","window_start"]', cols)

finish()
