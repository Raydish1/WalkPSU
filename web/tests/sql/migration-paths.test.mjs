// Upgrades that rewrite existing data: build state under an older schema, migrate, and check nothing is lost.
import { LAT, LNG, MIGRATIONS, actor, check, createDb, finish, migrate, superuser } from './harness.mjs'

const INDIVIDUAL = MIGRATIONS.find((m) => m.includes('individual_players'))
const REMOVE_CAPTURE = MIGRATIONS.find((m) => m.includes('remove_building_capture'))
const beforeIndividual = MIGRATIONS[MIGRATIONS.indexOf(INDIVIDUAL) - 1]
const beforeRemoval = MIGRATIONS[MIGRATIONS.indexOf(REMOVE_CAPTURE) - 1]
const PHOTO_HUNT = MIGRATIONS.find((m) => m.includes('photo_hunt'))
const beforePhotoHunt = MIGRATIONS[MIGRATIONS.indexOf(PHOTO_HUNT) - 1]

// --- Teams → individual players
{
  const db = await createDb()
  await migrate(db, { until: beforeIndividual })
  const as = actor(db)
  const su = superuser(db)
  const teams = (await su(`select id from teams order by name`)).map((t) => t.id)
  await as('alice', {}, `insert into players (display_name, team_id) values ('Alice', $1)`, [teams[0]])
  await as('bob', {}, `insert into players (display_name, team_id) values ('Bob', $1)`, [teams[1]])
  const drop = (await as('admin', { app_role: 'admin' }, `insert into drops (title, type, lat, lng, points, building_num) values ('Old', 'checkin', $1, $2, 20, '0001000') returning id`, [LAT, LNG])).rows[0].id
  check('setup: team-era claim captures a building', !!(await as('alice', {}, `select * from claim_drop($1, $2, $3)`, [drop, LAT, LNG])).rows)

  await migrate(db, { from: INDIVIDUAL, until: INDIVIDUAL })
  const players = await su(`select display_name, color from players order by created_at`)
  check('existing players get distinct colors', players.length === 2 && players[0].color !== players[1].color && players.every((p) => /^#[0-9a-f]{6}$/.test(p.color)), players)
  const control = await su(`select p.display_name from building_control b join players p on p.id = b.player_id`)
  check('captured building moves to the capturing player', control[0]?.display_name === 'Alice', control)
  check('team columns and table gone', (await su(`select to_regclass('public.teams') as t`))[0].t === null)
  check('the claim (and its points) survive', (await su(`select count(*)::int as n from claims`))[0].n === 1)
}

// --- Building capture removal
{
  const db = await createDb()
  await migrate(db, { until: beforeRemoval })
  const as = actor(db)
  const su = superuser(db)
  await as('a', {}, `insert into players (display_name) values ('a')`)
  const drop = (await as('admin', { app_role: 'admin' }, `insert into drops (title, type, lat, lng, points, building_num) values ('d', 'checkin', $1, $2, 20, '0001000') returning id`, [LAT, LNG])).rows[0].id
  await as('a', {}, `select * from claim_drop($1, $2, $3)`, [drop, LAT, LNG])
  check('setup: capture recorded before removal', (await su(`select count(*)::int as n from building_control`))[0].n === 1)

  await migrate(db, { from: REMOVE_CAPTURE, until: REMOVE_CAPTURE })
  check('building_control dropped', (await su(`select to_regclass('public.building_control') as t`))[0].t === null)
  check('and left the realtime publication', (await su(`select count(*)::int as n from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'building_control'`))[0].n === 0)
  const score = (await as('a', {}, `select points, claims from player_scores`)).rows?.[0]
  check('earlier points survive', score?.points === 20 && score.claims === 1, score)
  check('drops.building_num kept', (await su(`select building_num from drops where id = $1`, [drop]))[0].building_num === '0001000')
}

// --- Per-claim points (photo hunts)
{
  const db = await createDb()
  await migrate(db, { until: beforePhotoHunt })
  const as = actor(db)
  const su = superuser(db)
  await as('a', {}, `insert into players (display_name) values ('a')`)
  const drop = (await as('admin', { app_role: 'admin' }, `insert into drops (title, type, lat, lng, points) values ('d', 'checkin', $1, $2, 20) returning id`, [LAT, LNG])).rows[0].id
  await as('a', {}, `select * from claim_drop($1, $2, $3)`, [drop, LAT, LNG])

  await migrate(db, { from: PHOTO_HUNT, until: PHOTO_HUNT })
  check('existing claims get their drop’s points', (await su(`select points from claims`))[0].points === 20)
  const score = (await as('a', {}, `select points, claims from player_scores`)).rows?.[0]
  check('scores unchanged by the upgrade', score?.points === 20 && score.claims === 1, score)
  const later = (await as('admin', { app_role: 'admin' }, `insert into drops (title, type, lat, lng, points) values ('e', 'checkin', $1, $2, 7) returning id`, [LAT, LNG])).rows[0].id
  await su(`insert into claims (drop_id, player_id) select $1, id from players`, [later])
  check('claims inserted without points (claim_drop, finish_game) default to the drop’s', (await su(`select points from claims where drop_id = $1`, [later]))[0].points === 7)
}

finish()
