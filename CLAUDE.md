# WalkPSU

HackPSU project: a mobile-first web app that turns the Penn State (University Park) campus map into a live game board.

- **Admins** drop events at locations on the campus map: mini-games, photo hunts, check-ins.
- **Players** join one of four teams and race to a drop's location to claim it. Claiming means being physically there (GPS-checked) and completing the challenge.
- Claimed drops award points to the player's team; a leaderboard tracks team standings in real time.

Hard requirements for judging: team rivalry, phone motion (device sensors), and groups of 4+ players.

## Stack

- **Frontend:** React + Vite + TypeScript in `web/`, react-router, ESLint.
- **Map:** Leaflet via `react-leaflet`, OpenStreetMap tiles, centered on Old Main (`40.7982, -77.8599`).
- **Backend:** Supabase: Postgres (with RLS), Realtime, Storage.
- **Auth:** Auth0 for login and roles (`player`, `admin`), connected via Supabase third-party auth. Supabase verifies the Auth0 **ID token**, which an Auth0 Action stamps with `role: authenticated` and `app_role`.
  - **Fallback:** when `VITE_AUTH0_*` is empty, the app uses Supabase anonymous sign-ins plus an "enter name + pick team" screen. Both modes give RLS a JWT with a `sub`, so policies are identical.
- **Deploy:** Vercel with Root Directory `web`. Serverless functions for anything needing secret keys (Gemini, service role) go in `web/api/`.

## Layout

```
web/
  api/                 Vercel serverless functions (server-only secrets)
  src/
    App.tsx            Routes + bottom nav shell
    pages/             Map, Leaderboard, Profile, Admin (/admin)
    components/        Shared UI
    lib/               supabase client, auth0 config, data helpers, types
supabase/migrations/   SQL migrations (run in order)
docs/                  SCHEMA.md, SETUP.md, design notes
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
- Schema changes are new files in `supabase/migrations/`; update `docs/SCHEMA.md` and `web/src/lib/database.types.ts` in the same commit.
- Keep it demo-ready: commit working increments, no half-wired features on `main`.
