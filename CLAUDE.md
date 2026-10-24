# WalkPSU

HackPSU project: a mobile-first web app that turns the Penn State (University Park) campus map into a live game board.

- **Admins** drop events at locations on the campus map: mini-games, photo hunts, check-ins.
- **Players** join one of four teams and race to a drop's location to claim it. Claiming means being there: within 60 m by GPS, or by scanning the drop's QR code (for indoors, where GPS is unreliable).
- Claimed drops award points to the player's team. A drop placed at a campus building also **captures that building** for the team, and the map colors each building by the team that holds it.
- A leaderboard shows points and territory (buildings held) in real time.

Hard requirements for judging: team rivalry, phone motion (device sensors), and the game working for a group of 4+ players **in total** (not per team). Never enforce a minimum team size.

## Stack

- **Frontend:** React + Vite + TypeScript in `web/`, react-router, ESLint.
- **Map:** Leaflet via `react-leaflet` (canvas renderer), OpenStreetMap tiles, centered on Old Main (`40.7982, -77.8599`).
- **Buildings:** 958 University Park footprints from PASDA, simplified into the static `web/public/data/buildings.geojson`. Regenerate with `npm run fetch-buildings`. Never fetch PASDA at runtime. Buildings are keyed by PSU building number (`num`); the database stores only that number.
- **Backend:** Supabase: Postgres (with RLS), Realtime, Storage.
- **Auth:** Auth0 for login and roles (`player`, `admin`), connected via Supabase third-party auth. Supabase verifies the Auth0 **ID token**, which an Auth0 Action stamps with `role: authenticated` and `app_role`.
  - **Fallback:** when `VITE_AUTH0_*` is empty, the app uses Supabase anonymous sign-ins plus an "enter name + pick team" screen. Both modes give RLS a JWT with a `sub`, so policies are identical.
- **Deploy:** Vercel with Root Directory `web`. Serverless functions for anything needing secret keys (Gemini, service role) go in `web/api/`.

## Layout

```
web/
  api/                 Vercel serverless functions (server-only secrets)
  public/data/         buildings.geojson (generated, committed)
  scripts/             fetch-buildings.mjs (PASDA → simplified GeoJSON)
  src/
    App.tsx            Routes + bottom nav shell
    pages/             Map, Leaderboard, Profile, Admin (/admin), Claim (/claim/:dropId?key=), JoinScreen
    session/           Session state (Auth0 or anonymous fallback), useSession()
    components/        BuildingsLayer, BuildingPicker, DropQrList, BottomNav
    lib/               supabase client, api.ts helpers, hooks, database.types.ts
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
- Components talk to Supabase through `web/src/lib/api.ts`, not ad-hoc queries.
- Live data comes from `useLiveQuery` hooks in `lib/hooks.ts`. Call `refresh()` after your own writes so the screen updates even when the Realtime socket is down (venue Wi-Fi).
- Claim codes live in `drop_secrets` (admin-read only). Never add them to `drops`, which every player can read.
- Schema changes are new files in `supabase/migrations/`; update `docs/SCHEMA.md` and `web/src/lib/database.types.ts` in the same commit.
- Keep it demo-ready: commit working increments, no half-wired features on `main`.
