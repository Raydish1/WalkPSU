# WalkPSU

HackPSU project: a mobile-first web app that turns the Penn State (University Park) campus map into a live game board.

- **Admins** drop events on the campus map: Shake-Offs (`minigame`), photo hunts, check-ins.
- **Players compete as individuals.** There are no permanent teams, and each player gets a server-assigned map color. They race to a drop to claim it: inside the claim radius by GPS, or anywhere by scanning the drop's QR code (indoors, where GPS is unreliable).
- Claims award points. A drop can sit at a campus building, and the map highlights that building in the accent color while the drop is active. Buildings are never owned or captured.
- The leaderboard ranks players by points, live. Opted-in players appear live on the map (Realtime Presence).
- **Shake-Off:** players join a lobby at the drop (in range or by QR). At 4 joins (or an admin's Start) they're dealt into Blue vs White **for that game only** and shake their phones for 15 s. The side with more shakes per player wins, and every winner gets the drop's points. Phones show a named tug-of-war, and `/battle/:dropId` is the projector view.

Judging requirements: rivalry, phone motion, and the game working for **4+ players in total**. Never enforce a minimum group size. Never add permanent teams; Shake-Off sides are derived per game (`game_sides()`), never stored.

## Stack

- **Frontend:** React 19 + Vite + TypeScript in `web/`, react-router, ESLint (no Prettier config: match existing style, single quotes, no semicolons).
- **Map:** MapLibre GL 6 via `react-map-gl/maplibre` on OpenFreeMap Positron (no API key). The view is 2.5D Life360-style: pitch 45°, bearing −17°, `buildings.geojson` extruded 10–15 m, and buildings with an active drop in accent orange with a pulse. Everything drawn (claim circles, drops, players, my dot) is a GeoJSON source and layer, and taps open `Popup` cards.
- **Buildings:** 958 University Park footprints from PASDA, simplified into the static `web/public/data/buildings.geojson` (`npm run fetch-buildings` regenerates it; never fetch PASDA at runtime). Buildings are keyed by PSU building number `num`; the DB stores only that.
- **Backend:** Supabase: Postgres + RLS, Realtime (postgres_changes, broadcast, presence), Storage (`drop-hints` bucket).
- **Auth:** Auth0 via Supabase third-party auth. Supabase verifies the Auth0 **ID token**, which an Auth0 Action stamps with `role: authenticated` and `app_role`. When `VITE_AUTH0_*` is empty, the app falls back to Supabase anonymous sign-in plus an "enter your name" screen. Both give RLS a JWT `sub`, so policies are identical.
- **Deploy:** Vercel, Root Directory `web`. `web/vercel.json` holds the SPA rewrite. Secret-key code goes in `web/api/` (none yet).

## Layout

```
web/
  public/data/         buildings.geojson (generated, committed)
  scripts/             fetch-buildings.mjs (PASDA → simplified GeoJSON, mapshaper)
  src/
    App.tsx            routes; bottom nav hidden on /game and /battle
    pages/             Map, Leaderboard, Profile, Admin (/admin), Claim (/claim/:dropId?key=), JoinScreen,
                       Game (/game/:dropId), Battle (/battle/:dropId)
    game/              Shake-Off: shakeoff.ts (phase model, side math, names), useGame, useShakes,
                       useShakeBroadcast, TugBar, Results (winner headline + MVP)
    session/           SessionProvider (Auth0 or anonymous) + PresenceProvider (the only GPS watcher)
    components/        CampusMap (MapLibre wrapper), BuildingPicker, DropQrList, BottomNav
    map/               basemap.ts (declutter + landmarks), geometry.ts (geodesic circles, heights), worker.ts
    lib/               supabase.ts, api.ts (all DB calls), hooks.ts, geo.ts, buildings.ts, database.types.ts
supabase/migrations/   SQL, applied in filename order
docs/                  SCHEMA.md (tables/functions, keep current), SETUP.md (Supabase/Auth0/Vercel steps)
```

## Migrations (run in this order in the Supabase SQL Editor; never edit an applied one)

1. `20261024000000_init.sql`: teams, players, drops, claims, RLS, `claim_drop`, `distance_m`, `drop-hints` bucket.
2. `20261024010000_territory_and_qr.sql`: `drops.building_num`, building capture, `drop_secrets` (QR codes).
3. `20261024020000_individual_players.sql`: drops teams, adds `players.color`, `claim_radius_m()`, `player_scores`.
4. `20261024030000_shake_off.sql`: `games`, `game_players`, Shake-Off functions, claims unique per (drop, player).
5. `20261024040000_remove_building_capture.sql`: drops `building_control` and the capture logic.

Every schema change is a new migration. Update `docs/SCHEMA.md` and `web/src/lib/database.types.ts` (hand-written) in the same commit.

## Rules (don't break these)

- Authorization lives in RLS and `security definer` functions. Clients write only through functions; direct writes to `claims`, `games`, and `game_players` are blocked. The anon key is public.
- `claim_drop` refuses `minigame` drops. Shake-Off payout happens only in `finish_game`.
- The GPS radius exists only in SQL `claim_radius_m()`; the client reads it (`useClaimRadius`). Never hard-code 60. `distanceM` (TS) must stay identical to SQL `distance_m` (same haversine, R = 6,371 km).
- Shake-Off timing and caps come from `get_game_state().settings` plus `server_now` (clock-skew offset). Never hard-code 15 s or 8 shakes/s. Broadcast counts are cosmetic; only capped `submit_shakes` totals decide winners.
- Claim codes live only in `drop_secrets` (admin-read). Never put them in `drops`.
- Live locations go only over the Presence channel `campus`; never store them. Read position from `usePresence()` and never start a second geolocation watcher.
- Components call Supabase only through `lib/api.ts`. Live data uses `useLiveQuery`; call `refresh()` after your own writes (venue Wi-Fi drops Realtime). `useGame` also polls every 2 s.
- Player names are user input. React escapes them; anything put into raw HTML must be escaped.
- Phones first: `100dvh`, safe-area insets, 48 px touch targets.

## Fragile: read before touching

- **MapLibre worker (do not remove).** MapLibre 6 loads its worker from a separate file. `src/map/worker.ts` calls `setWorkerUrl` with a Vite `?worker&url` import, and `vite.config.ts` has `optimizeDeps.exclude: ['maplibre-gl']`. Remove either and GeoJSON sources never load: the map is blank in production ("Worker failed to load") or silently blank in dev.
- After installing or removing deps while `npm run dev` runs, Vite's dep cache can point at deleted packages and the page goes blank. Stop the server, `rm -rf web/node_modules/.vite`, and restart.
- `map.loaded()` stays false forever because the highlight pulse keeps a paint transition running. Use `isStyleLoaded()` plus rendered features instead.
- react-map-gl's `Map` takes no `className`; `CampusMap` wraps it in a sized `div`. `maxBounds` must be a flat `[w, s, e, n]`.
- `campusBounds` deliberately ignores far-off PASDA property (Ag Progress Days, the airport) by keeping buildings within 2.5 km of the median building, then pads by 1.6 km.
- In `game_sides`, `finish_game`, and `submit_shakes`, phase is derived from `started_at` (no server timer), and `finish_game` is idempotent and retried by every client. Keep both properties.
- Building names in PASDA are formal ("Hetzel Union Building (Ralph Dorn)"). `BUILDING_NICKNAMES` in `lib/campus.ts` makes HUB, BJC, and IST searchable, and `LANDMARKS` in `map/basemap.ts` labels the map.

## Testing approach

There is no automated test suite in the repo yet. The harnesses below lived in a session scratchpad and are **not committed**; rebuild them if needed.

- **SQL:** `@electric-sql/pglite` (in-process Postgres). Stub Supabase first: roles `anon`/`authenticated`, schemas `auth`/`storage`, `auth.jwt()` reading `current_setting('request.jwt.claims')`, `storage.buckets`/`storage.objects`, and publication `supabase_realtime`. Apply the migrations in order, then grant table privileges as Supabase does by default. Impersonate a user with `set_config('request.jwt.claims', '{"sub":...}')` + `set role authenticated`. Time-travel Shake-Off by updating `games.started_at` as superuser.
- **UI:** a small Node HTTP server that mocks Supabase REST/auth/RPC (anonymous signup returning a fake JWT, tables, `claim_drop`, the Shake-Off RPCs with bot players). Point a temporary `web/.env.local` (gitignored) at it, and delete it afterwards. It has no Realtime, which is why the `refresh()`/poll fallbacks matter.
- **Map:** the in-app browser pane often stops firing `requestAnimationFrame`, so MapLibre never renders there. Use headless **Microsoft Edge** through `playwright-core` (`executablePath: C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`, args `--use-angle=swiftshader --enable-unsafe-swiftshader`). Emulate 375×812, DPR 2, touch, and a geolocation grant. A dev-only `window.__map` hook helps; remove it before committing. Measured about 78 fps on software GL.
- Simulate shaking with `new DeviceMotionEvent('devicemotion', { acceleration: {x: 22, ...} })`. Delete `DeviceMotionEvent.requestPermission` first, because desktop Chromium has it and answers "denied".
- Before every commit run `npm run lint` and `npm run build` in `web/`.

## Windows environment gotchas

- The shell is Git Bash on Windows. Long heredocs containing JSX or quotes sometimes fail ("unexpected EOF while looking for matching `'`"). Write the script to a file with the Write tool, or use Write/Edit directly.
- Python's default encoding is cp1252, which corrupts or truncates files containing `→`, `…`, or emoji. Always use `PYTHONUTF8=1` and `open(..., encoding='utf-8')`.
- Running `npx prettier` uses default config (double quotes, semicolons) and restyles files. Don't.
- Node can't import `C:/...` paths as ESM; use `file:///C:/...`. Node 24 runs `.ts` files directly (type stripping).
- Git warns "LF will be replaced by CRLF" on every commit. It's harmless.
- A teammate (shiyx1224-shi) also pushes to `main`. `git fetch` before pushing and merge (never force-push).

## Commands (from `web/`)

```bash
npm install
npm run dev              # dev server (5173, or 5174 if taken)
npm run build            # typecheck + production build
npm run lint
npm run fetch-buildings  # regenerate public/data/buildings.geojson
```

Copy `web/.env.example` to `web/.env`. `VITE_*` vars ship to the browser; secrets must not use that prefix. Never commit `.env`.
