# WalkPSU

Hackathon project: a mobile-first web app that turns the Penn State (University Park) campus map into a live game board.

- **Admins** drop mini-game events at locations on the campus map.
- **Players** join teams and race to an event's location to claim it. Claiming means being physically there and completing the mini-game.
- Claimed events award points to the player's team; a leaderboard tracks team standings in real time.

## Stack

- **Frontend:** React + Vite + TypeScript, in `web/`. ESLint for linting.
- **Map:** Leaflet via `react-leaflet`, with OpenStreetMap tiles. The map centers on Old Main (`40.7982, -77.8599`).
- **Backend:** Supabase
  - Auth: player and admin accounts
  - Postgres: teams, players, events, claims, scores
  - Realtime: push new events, claims, and score changes to every connected client

## Layout

```
web/            React app (Vite)
  src/App.tsx   Full-screen campus map
  src/lib/      Shared clients (supabase.ts)
docs/           Design notes, schema, and planning docs
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

Copy `web/.env.example` to `web/.env` and fill in the Supabase project URL and anon key. `.env` is gitignored. Never commit keys.

## Conventions

- Design for phones first: touch targets, `100dvh` layouts, safe-area insets. Desktop is secondary.
- Keep secrets and authorization in Supabase (Row Level Security), not in client code. The anon key is public by design.
- Put schema and design decisions in `docs/`.
