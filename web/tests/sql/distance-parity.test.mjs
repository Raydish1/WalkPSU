// The client enables Claim when distanceM() <= radius; the server accepts when distance_m() <= radius.
// They must agree, especially right at the 60 m edge.
import { distanceM } from '../../src/lib/geo.ts'
import { check, createDb, finish, migrate } from './harness.mjs'

const db = await createDb()
await migrate(db)
const radius = (await db.query('select claim_radius_m() as r')).rows[0].r

let worst = 0
let disagreements = 0
for (let i = 0; i < 2000; i++) {
  const lat1 = 40.78 + Math.random() * 0.05
  const lng1 = -77.89 + Math.random() * 0.06
  const bearing = Math.random() * 2 * Math.PI
  const meters = radius - 5 + Math.random() * 10
  const lat2 = lat1 + (meters * Math.cos(bearing)) / 111_195
  const lng2 = lng1 + (meters * Math.sin(bearing)) / (111_195 * Math.cos((lat1 * Math.PI) / 180))
  const sql = (await db.query('select distance_m($1, $2, $3, $4) as d', [lat1, lng1, lat2, lng2])).rows[0].d
  const ts = distanceM(lat1, lng1, lat2, lng2)
  worst = Math.max(worst, Math.abs(sql - ts))
  if (sql <= radius !== ts <= radius) disagreements++
}
check(`TS and SQL distances match (max diff ${worst.toExponential(1)} m over 2000 pairs near ${radius} m)`, worst < 1e-6, { worst })
check('no in-range disagreements', disagreements === 0, { disagreements })

finish()
