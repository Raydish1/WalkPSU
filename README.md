# WalkPSU

Mobile-first campus exploration game for Penn State University Park. Race across campus, claim drops, and compete on a live MapLibre campus map.

## UI

Dark navy game shell with Penn State blue, white type, and cyan accents. The main screen centers the 2.5D campus map with:

- Challenge-colored landmark buildings
- Compact player HUD (avatar, level, XP, squad color)
- Current mission card
- Landmark detail sheet (status, difficulty, points, Start Challenge)
- Bottom nav: Map · Challenges · Leaderboard · Profile

## Run locally

```bash
cd web
cp .env.example .env
# Option A — mock backend (no Supabase project needed):
node tests/mock/supabase.mjs &
# then in .env:
#   VITE_SUPABASE_URL=http://127.0.0.1:54321
#   VITE_SUPABASE_ANON_KEY=mock
npm install
npm run dev -- --host 127.0.0.1 --port 43123
```

For a real project, fill Supabase keys (see `docs/SETUP.md`).

## Stack

React + Vite + TypeScript, MapLibre campus map, Supabase backend, optional Auth0. Details in `CLAUDE.md`.
