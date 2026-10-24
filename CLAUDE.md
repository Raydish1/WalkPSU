# WalkPSU

HackPSU project: a mobile-first web app that turns the Penn State (University Park) campus map into a live game board.

- **Admins** drop events at locations on the campus map: mini-games, photo hunts, check-ins.
- **Players compete as individuals** (no permanent teams; each player gets a map color). They race to a drop's location to claim it. Claiming means being there: inside the drop's claim radius by GPS, or by scanning its QR code (for indoors, where GPS is unreliable).
- Claimed drops award points. A drop placed at a campus building also **captures that building** for the player, and the map fills each building with its holder's color.
- A leaderboard ranks players by points and territory (buildings held) in real time. Opted-in players appear live on the map (Realtime Presence).

- **Shake-Off** (`minigame` drops): players join a lobby at the drop (in range or by QR). At 4 players (or an admin's Start) they're split at random into Blue vs White for that game only, then shake their phones for 15 s. The side with more shakes per player wins, and every winner gets the drop's points. Phones show a live tug-of-war; `/battle/:dropId` is the projector view.

Hard requirements for judging: rivalry, phone motion (device sensors), and the game working for a group of 4+ players **in total**. Never enforce a minimum group size. Never add permanent teams; mini-game sides are per game and derived (`game_sides()`), not stored.

## Stack

- **Frontend:** React + Vite + TypeScript in `web/`, react-router, ESLint.
- **Map:** Leaflet via `react-leaflet` (canvas renderer), OpenStreetMap tiles, centered on Old Main (`40.7982, -77.8599`). Both maps use `components/CampusMap.tsx`, which locks `maxBounds` and `minZoom` to the campus core plus ~1.6 km (`campusBounds` in `lib/geo.ts`).
- **Buildings:** 958 University Park footprints from PASDA, simplified into the static `web/public/data/buildings.geojson`. Regenerate with `npm run fetch-buildings`. Never fetch PASDA at runtime. Buildings are keyed by PSU building number (`num`); the database stores only that number.
- **Backend:** Supabase: Postgres (with RLS), Realtime, Storage.
- **Auth:** Auth0 for login and roles (`player`, `admin`), connected via Supabase third-party auth. Supabase verifies the Auth0 **ID token**, which an Auth0 Action stamps with `role: authenticated` and `app_role`.
  - **Fallback:** when `VITE_AUTH0_*` is empty, the app uses Supabase anonymous sign-ins plus an "enter your name" screen. Both modes give RLS a JWT with a `sub`, so policies are identical.
- **Deploy:** Vercel with Root Directory `web`. Serverless functions for anything needing secret keys (Gemini, service role) go in `web/api/`.

## Layout

```
web/
  api/                 Vercel serverless functions (server-only secrets)
  public/data/         buildings.geojson (generated, committed)
  scripts/             fetch-buildings.mjs (PASDA → simplified GeoJSON)
  src/
    App.tsx            Routes + bottom nav shell
    pages/             Map, Leaderboard, Profile, Admin (/admin), Claim (/claim/:dropId?key=), JoinScreen,
                       Game (/game/:dropId), Battle (/battle/:dropId, projector)
    game/              Shake-Off: phase model, useGame, useShakes (DeviceMotion), useShakeBroadcast, TugBar
    session/           Session (Auth0 or anonymous fallback) + Presence (GPS watcher, live players)
    components/        CampusMap, BuildingsLayer, BuildingPicker, DropQrList, BottomNav
    lib/               supabase client, api.ts helpers, hooks, geo.ts, database.types.ts
supabase/migrations/   SQL migrations (run in order)
docs/                  SCHEMA.md (tables, RLS, functions), SETUP.md (Supabase/Auth0/Vercel)
```

## Commands

Run from `web/`:

```bash
npm install
npm run dev      # dev server
npm run build    # typecheck + production build
npm run lint     # ESLint
```

## Environment

Copy `web/.env.example` to `web/.env`. `VITE_*` vars ship to the browser; anything secret must not have that prefix and is only read in `web/api/`. Never commit `.env`.

## Conventions

- Phones first: `100dvh` layouts, safe-area insets, large touch targets. Desktop is secondary.
- Authorization lives in Postgres RLS and `security definer` functions, never in client checks alone. The anon key is public by design.
- Game rules that must not be cheated (claiming, scoring) run in SQL functions (`claim_drop`), not in the client.
- The GPS claim radius lives only in SQL `claim_radius_m()`; the client reads it via `useClaimRadius()`. Never hard-code 60 in the client. Client distance math (`distanceM`) must stay identical to SQL `distance_m`.
- Shake-Off rules (joining, start timing, shake caps, winner, payouts) live in SQL. Client timing comes from `get_game_state().settings` and `server_now`; never hard-code the 15 s or the caps. Live counts over broadcast are cosmetic; only `submit_shakes` totals count.
- Live locations go over the Presence channel `campus` only. Never store them in the database. Read position from `usePresence()`; don't start another geolocation watcher.
- Components talk to Supabase through `web/src/lib/api.ts`, not ad-hoc queries.
- Live data comes from `useLiveQuery` hooks in `lib/hooks.ts`. Call `refresh()` after your own writes so the screen updates even when the Realtime socket is down (venue Wi-Fi).
- Claim codes live in `drop_secrets` (admin-read only). Never add them to `drops`, which every player can read.
- Schema changes are new files in `supabase/migrations/`; update `docs/SCHEMA.md` and `web/src/lib/database.types.ts` in the same commit.
- Keep it demo-ready: commit working increments, no half-wired features on `main`.
