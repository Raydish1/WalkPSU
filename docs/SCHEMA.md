# Schema

Source of truth: the files in `supabase/migrations/`, applied in order. TypeScript mirror: `web/src/lib/database.types.ts`. Call everything through `web/src/lib/api.ts`.

## Identity

Every request carries a JWT. Its `sub` claim is the user's id: the Auth0 user id (`auth0|abc…`) or, in fallback mode, the Supabase anonymous user id. `players.auth_id` stores that `sub`, and the database fills it in automatically on insert. You never send it.

A user is an **admin** if either:

- the Auth0 ID token has `app_role: "admin"` (set by the Auth0 Action from the user's Auth0 roles), or
- their `players.is_admin` is `true` (set by hand in the Supabase dashboard; this is how admins work in fallback mode).

## Tables

### `teams`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid | |
| `name` | text | unique |
| `color` | text | hex, used for map/leaderboard styling |

Seeded with Nittany Lions, Creamery Crew, Beaver Blitz, Old Main Owls. Readable by anyone, even signed out (the join screen needs it).

### `players`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid | |
| `auth_id` | text | JWT `sub`, unique, set by the database |
| `display_name` | text | 1–32 chars |
| `team_id` | uuid → `teams` | required |
| `is_admin` | boolean | default false; clients cannot write it |
| `created_at` | timestamptz | |

Players can insert and update only their own row, and only `display_name` and `team_id`.

### `drops`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid | |
| `title` | text | |
| `type` | `minigame` \| `photo_hunt` \| `checkin` | |
| `lat`, `lng` | double precision | |
| `points` | integer | > 0, default 10 |
| `status` | `active` \| `claimed` \| `expired` | default `active`; becomes `claimed` via `claim_drop` |
| `hint_photo_url` | text | public URL in the `drop-hints` storage bucket |
| `building_num` | text | PSU building number (`num` in `buildings.geojson`). null = open-ground drop. Claiming captures this building |
| `created_by` | uuid → `players` | |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | null = never. Past this time the drop can't be claimed even if `status` is still `active` |

Only admins can insert, update, or delete. Everyone signed in can read.

### `claims`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid | |
| `drop_id` | uuid → `drops` | **unique**: one claim per drop |
| `player_id` | uuid → `players` | |
| `team_id` | uuid → `teams` | the player's team at claim time |
| `created_at` | timestamptz | |

Read-only for clients. Rows are created only by `claim_drop`.

### `building_control`

| column | type | notes |
| --- | --- | --- |
| `building_num` | text | primary key; one row per captured building |
| `team_id` | uuid → `teams` | current holder |
| `claim_id` | uuid → `claims` | the claim that captured it |
| `captured_at` | timestamptz | |

Read-only for clients. `claim_drop` upserts the row, so a later claim at the same building by another team recaptures it. Buildings with no row are unclaimed. Polygons and names come from `web/public/data/buildings.geojson`, not the database.

### `drop_secrets`

| column | type | notes |
| --- | --- | --- |
| `drop_id` | uuid → `drops` | primary key |
| `claim_code` | text | 32-char random code encoded in the drop's QR |

Created automatically by a trigger when a drop is inserted. **Only admins can read it**; players never see codes except by scanning. The QR encodes `https://<app>/claim/<drop_id>?key=<claim_code>`.

### `team_scores` (view)

`team_id, name, color, points, claims, buildings` for every team. `points` is the sum of claimed drops' points; `buildings` is how many buildings the team currently holds. Runs with the caller's permissions.

## Functions

- **`claim_drop(p_drop_id, p_lat?, p_lng?, p_code?) → claims`**. Claims a drop for the caller's team and, if the drop has a `building_num`, captures that building. It locks the drop row, so if two players tap at once exactly one wins. Proof is either the drop's QR `p_code` (any distance) or a GPS position. It raises an error with a user-facing message when:
  - the caller hasn't joined a team,
  - the drop is gone, claimed, or expired,
  - the code is wrong,
  - there's no code and no position,
  - there's no code and the caller is more than **60 m** away (great-circle distance).

  Client: `claimDrop(dropId, { lat, lng })` or `claimDrop(dropId, { code })`.
- **`is_admin() → boolean`**. Used by RLS. It's callable from the client too, but the app derives admin status from the session.
- **`distance_m(lat1, lng1, lat2, lng2) → meters`**. Haversine distance.

## Realtime

`drops`, `claims`, and `building_control` are in the `supabase_realtime` publication. `subscribeToDrops(cb)` fires on every drop insert, update, or delete. Claims flip a drop's `status`, so this one channel is enough to refresh both the map and the leaderboard.

## Storage

Bucket `drop-hints` is public-read. Only admins can upload to it. Use `uploadHintPhoto(file)`, which returns the public URL.

## Changing the schema

Add a new migration file (don't edit the applied one). Update `database.types.ts` and this doc in the same commit.
