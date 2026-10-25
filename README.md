# WalkPSU

A mobile-first web app, built at HackPSU, that turns the Penn State University Park campus map into a live game board.
Admins drop events on the map. Players race across campus to claim them and climb a live leaderboard.

## What you can do

- **Claim drops.** Walk inside a drop's claim radius (GPS) or scan its QR code (indoors) to win its points. A drop at a
  campus building lights that building up on the map.
- **Play mini-games at a drop.** Players join a lobby on the spot. Every phone plays in sync, and `/battle/:dropId` is
  the projector view. In the first three games, players are split at random into Blue vs White for that one game.
  - **Shake-Off:** shake your phone for 15 seconds. Most shakes per player wins.
  - **Quick Draw:** hold still, then flick your phone the instant it flashes DRAW! Three rounds, timed on the phone.
  - **Point to the Landmark:** point your phone at a famous landmark you can't see, using the compass. Three rounds.
    The projector reveals everyone's arrows on a map.
  - **Needle Rain:** tilt to dodge a shared storm of needles. Last one standing wins.
- **Photo hunts.** Find the spot in a reference photo and take your own photo there. Gemini checks it. The first finder
  gets full points, and later finders get less.
- **Meetups.** Pin "volleyball here right now" at your spot for others to join. Meetups have no points; they're just
  for meeting people.
- **Walk.** Your trail fades behind you, nearby players show up live (opt-in), and walking clears a fog of war over
  campus.
- **Find events with AI.** Tap "Find events you'd like…" on the map and describe what you're into. Gemini picks
  matching upcoming events from [Penn State Discover](https://discover.psu.edu/events) and the live drops on the map,
  with a reason for each. Pick one and the map flies to its building. Searches are never stored.
- **Real campus events.** Seed check-in drops from upcoming Discover events.
- **Earn badges.** The leaderboard shows achievements at 100, 500, and 1,000 points.

Players compete as individuals. There are no permanent teams, and live locations are never stored.

## Run it

Everything lives in `web/` and needs Node 24.

**With no backend (a mock Supabase with bots), for trying the UI:**

```bash
cd web && npm install && npm run mock
```

Then, in a second terminal:

```bash
cd web && VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_ANON_KEY=mock npm run dev
```

Open http://localhost:5173 and enter a name. In the mock, everyone is an admin, and bots wait in the mini-game lobbies.

**With a real Supabase project:** copy `web/.env.example` to `web/.env`, then follow [docs/SETUP.md](docs/SETUP.md)
(migrations, keys, optional Auth0 login, Vercel deploy). Without Auth0, players sign in by entering a name.

Phone sensors (motion, compass) and GPS need HTTPS on a real phone, so test those on the Vercel deploy.

## Tests

From `web/`:

```bash
npm test
```

That runs the SQL tests (every migration in in-process Postgres, through real row-level security), the API tests
(photo check and event search, with Gemini faked), and end-to-end tests that play each game in headless Microsoft
Edge against a production build. Also run `npm run lint` and `npm run build` before committing.

## Stack

- React 19, Vite and TypeScript
- MapLibre GL on OpenFreeMap tiles, with 958 campus building footprints from PASDA
- Supabase: Postgres with row-level security, Realtime, Storage
- Auth0 login, with an anonymous name-only fallback
- Gemini for photo hunts and event search
- Vercel hosting

## Docs

- [docs/SETUP.md](docs/SETUP.md): setting up Supabase, Auth0, Vercel, and the campus-event import
- [docs/SCHEMA.md](docs/SCHEMA.md): tables, functions, and game rules on the server
- [CLAUDE.md](CLAUDE.md): architecture, project rules, and the fragile parts, for anyone (or any agent) changing the
  code
