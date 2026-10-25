// In-process Postgres (PGlite) with just enough of Supabase stubbed to run supabase/migrations and exercise RLS.
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url))

/** Migration filenames in apply order. */
export const MIGRATIONS = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()

export async function createDb() {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text);
    alter table storage.objects enable row level security;
    create publication supabase_realtime;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.jwt() to anon, authenticated, service_role;
    -- Supabase grants API roles full table privileges by default; migrations then narrow them.
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `)
  return db
}

/** Applies migrations by filename (or every migration up to and including `until`). */
export async function migrate(db, { from, until } = {}) {
  const start = from ? MIGRATIONS.indexOf(from) : 0
  const end = until ? MIGRATIONS.indexOf(until) : MIGRATIONS.length - 1
  for (const file of MIGRATIONS.slice(start, end + 1)) {
    await db.exec('reset role')
    await db.exec(readFileSync(MIGRATIONS_DIR + file, 'utf8'))
  }
}

/** Runs `q` as an authenticated user whose JWT has `sub` plus any extra claims (e.g. { app_role: 'admin' }). */
export function actor(db) {
  return async (sub, claims, q, params) => {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub, ...claims })])
    await db.exec('set role authenticated')
    try {
      return { rows: (await db.query(q, params)).rows }
    } catch (e) {
      return { error: e.message }
    }
  }
}

/** Runs `q` as the service role, the way server code in web/api does (no user JWT). */
export function serviceRole(db) {
  return async (q, params) => {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claims', '', false)`)
    await db.exec('set role service_role')
    try {
      return { rows: (await db.query(q, params)).rows }
    } catch (e) {
      return { error: e.message }
    }
  }
}

/** Runs `q` as the superuser (for setup and time travel). */
export function superuser(db) {
  return async (q, params) => {
    await db.exec('reset role')
    return (await db.query(q, params)).rows
  }
}

let failures = 0
export function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ' :: ' + JSON.stringify(detail)}`)
  if (!ok) failures++
}

export function finish() {
  if (failures) {
    console.log(`\n${failures} check(s) failed`)
    process.exit(1)
  }
}

export const LAT = 40.7982
export const LNG = -77.8599
/** 1° of latitude in meters on the 6371 km sphere distance_m() uses. */
export const M_PER_DEG_LAT = 111_195
