# Schema

Source of truth: the files in `supabase/migrations/`, applied in order. TypeScript mirror: `web/src/lib/database.types.ts`. Call everything through `web/src/lib/api.ts`.

Players compete as **individuals**. There are no permanent teams anywhere in the data model (migration `20261024020000_individual_players.sql` removed them). Buildings aren't owned or captured (migration `20261024040000_remove_building_capture.sql` removed that).

## Identity

Every request carries a JWT. Its `sub` claim is the user's id: the Auth0 user id (`auth0|abc…`) or, in fallback mode, the Supabase anonymous user id. `players.auth_id` stores that `sub`, and the database fills it in automatically on insert. You never send it.

A user is an **admin** if either:

- the Auth0 ID token has `app_role: "admin"` (set by the Auth0 Action from the user's Auth0 roles), or
- their `players.is_admin` is `true` (set by hand in the Supabase dashboard; this is how admins work in fallback mode).

## Tables

### `players`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid | |
| `auth_id` | text | JWT `sub`, unique, set by the database |
| `display_name` | text | 1–32 chars |
| `color` | text | hex map color, server-assigned on insert (least-used color of a 12-color palette) |
| `is_admin` | boolean | default false |
| `created_at` | timestamptz | |

Every signed-in user can read all players. A player can insert and update only their own row, and only `display_name`. `color` and `is_admin` can't be written by clients.

### `drops`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid | |
| `title` | text | |
| `type` | `minigame` \| `photo_hunt` \| `checkin` \| `math` \| `chemistry` | `math` = mental-math at `/math/:dropId`; `chemistry` = element/formula quiz at `/chem/:dropId` (claim after solving) |
| `category` | text (nullable) | Event theme for search/filter: `sports` \| `culture` \| `academics` \| `social` \| `campus`. Null → client infers from title |
| `lat`, `lng` | double precision | |
| `points` | integer | > 0, default 10 |
| `status` | `active` \| `claimed` \| `expired` | default `active`; becomes `claimed` via `claim_drop` |
| `hint_photo_url` | text | public URL in the `drop-hints` storage bucket |
| `building_num` | text | PSU building number (`num` in `buildings.geojson`). null = open-ground drop. The map highlights a building while it hosts an active drop |
| `created_by` | uuid → `players` | |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | null = never. Past this time the drop can't be claimed even if `status` is still `active` |

Only admins can insert, update, or delete. Everyone signed in can read.

### `claims`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid | |
| `drop_id` | uuid → `drops` | unique together with `player_id` |
| `player_id` | uuid → `players` | who claimed it |
| `created_at` | timestamptz | |

Read-only for clients. Rows come only from `claim_drop` (one claim per ordinary drop: it locks the drop and flips it to `claimed`) and `finish_game` (one claim per winner of a Shake-Off).

### `drop_secrets`

| column | type | notes |
| --- | --- | --- |
| `drop_id` | uuid → `drops` | primary key |
| `claim_code` | text | 32-char random code encoded in the drop's QR |

Created automatically by a trigger when a drop is inserted. **Only admins can read it**; players never see codes except by scanning. The QR encodes `https://<app>/claim/<drop_id>?key=<claim_code>`.

### `games` (Shake-Off)

One per `minigame` drop, created by the first `join_game`.

| column | type | notes |
| --- | --- | --- |
| `drop_id` | uuid → `drops` | primary key |
| `seed` | text | random; decides sides and tie-breaks. Hidden from `get_game_state` |
| `created_at` | timestamptz | |
| `started_at` | timestamptz | null until scheduled. The future time the game begins; the lobby closes then |
| `finished_at` | timestamptz | set by `finish_game` |
| `winner_side` | `blue` \| `white` | |

### `game_players`

| column | type | notes |
| --- | --- | --- |
| `drop_id`, `player_id` | uuid | primary key |
| `joined_at` | timestamptz | |
| `shakes` | integer | the server-capped count from `submit_shakes` |

Both are read-only for clients and in the Realtime publication. Sides aren't stored: `game_sides(drop_id)` deals them from the seed once `started_at` is set, so every caller sees the same balanced split. Teams exist only inside one game.

### `player_scores` (view)

`player_id, display_name, color, points, claims` for every player. `points` is the sum of their claimed drops' points. Runs with the caller's permissions. The leaderboard orders by points, then name.

## Functions

- **`claim_drop(p_drop_id, p_lat?, p_lng?, p_code?) → claims`**. Claims a drop for the caller. It locks the drop row, so if two players tap at once exactly one wins. Proof is either the drop's QR `p_code` (any distance) or a GPS position within `claim_radius_m()`. It raises an error with a user-facing message when:
  - the caller hasn't joined,
  - the drop is gone, claimed, or expired,
  - the code is wrong,
  - there's no code and no position,
  - there's no code and the caller is too far away.

  Client: `claimDrop(dropId, { lat, lng })` or `claimDrop(dropId, { code })`.
- **Shake-Off functions** (all keyed by the drop id; phases come from timestamps, so there's no server timer):
  - `get_game_state(drop) → { server_now, settings, game, players[] }`. One call per screen. `server_now` lets phones correct skewed clocks.
  - `join_game(drop, lat?, lng?, code?)`. Same proof as claiming. Rejoining is a no-op. Joining closes at `started_at`. The 4th player schedules the start `auto_start_delay_seconds` out.
  - `start_game(drop)`. Admin only, needs 2+ players. Pulls the start in to `admin_start_delay_seconds` from now.
  - `submit_shakes(drop, count)`. Running total during and just after the game. Stored as `greatest(previous, min(count, floor(elapsed_seconds × max_shakes_per_second)))`, so a client can't report more than a human could shake.
  - `finish_game(drop)`. Idempotent; any client calls it after `game_seconds + submit_grace_seconds`. The higher **average shakes per player** wins (fair for uneven sides). An exact tie goes to a seeded coin flip. Every winner gets a claim worth the drop's points, and the drop is marked claimed.
  - `shake_off_settings()`: `game_seconds` 15, `auto_start_players` 4, `auto_start_delay_seconds` 15, `admin_start_delay_seconds` 5, `max_shakes_per_second` 8, `submit_grace_seconds` 3. The client reads them from `get_game_state`; don't copy them into client code.
  - `claim_drop` refuses `minigame` drops, so the game can't be skipped.
- **`claim_radius_m() → meters`** (currently 60). This is the one place the GPS claim radius is defined. `claim_drop` uses it, and the client fetches it (`getClaimRadius()` / `useClaimRadius()`) to draw each drop's radius circle and to enable the Claim button. Change it here and both follow.
- **`distance_m(lat1, lng1, lat2, lng2) → meters`**. Haversine on a 6,371 km sphere. `web/src/lib/geo.ts` `distanceM` uses the identical formula, so the client's "in range" matches the server.
- **`next_player_color() → text`**. Default for `players.color`.
- **`is_admin() → boolean`**. Used by RLS. It's callable from the client too, but the app derives admin status from the session.

## Realtime

`drops`, `claims`, `games`, and `game_players` are in the `supabase_realtime` publication. `subscribeToDrops(cb)` fires on every drop insert, update, or delete. Claims flip a drop's `status`, so this one channel is enough to refresh the map and the leaderboard.

### Broadcast: live Shake-Off counts

Channel `shakeoff:<drop_id>`, event `shakes`, payload `{ playerId, count }`. Each participant sends about every 500 ms. It only drives the tug-of-war bar on phones and `/battle/:dropId`. The winner is decided solely from the capped counts stored by `submit_shakes`.

### Presence: live player locations

Live locations use the Realtime **Presence** channel `campus`, keyed by player id. They are **never written to the database**. A player who has "Show me on the map" on (Profile; default on, stored per device) broadcasts this payload:

```ts
{ playerId, name, color, lat, lng }
```

It sends at most every 5 s, only while the app is open and visible. It untracks when the tab is hidden or the toggle is turned off. See `web/src/session/PresenceProvider.tsx`.

## Storage

Bucket `drop-hints` is public-read. Only admins can upload to it. Use `uploadHintPhoto(file)`, which returns the public URL.

## Changing the schema

Add a new migration file (don't edit the applied one). Update `database.types.ts` and this doc in the same commit.
