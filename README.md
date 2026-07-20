# Rackio

A personal dashboard for the services running on your home rack. Rackio is a
grid-based board: every service gets a card, cards drag into whatever layout
fits how you check in, and each card supports three responsive footprints —
**small** (2×2), **big** (4×4), and **wide** (4×2) — with a tailored layout for
each, not just scaling.

Rackio exists because rack dashboards tend to be link walls. The goal here is a
board that feels like a control surface: live weather rendered with WebGL,
what you're reading in Calibre, whether Plex and Home Assistant are up — at a
glance, arranged your way.

**Status**: M3 (weather card) — the board is playable and useful: edit mode,
drag by handle on a square-cell 12-column grid, per-card footprint switching,
an "Add card" catalog, per-card settings in a flip-to-center panel. The
layout persists **server-side** (`data/board.json`) with newer-wins conflict
resolution against the localStorage cache. Card types: **weather** (live
Open-Meteo conditions rendered as an animated WebGL sky — shader clouds,
rain, snow, storm lightning — with a location picker in settings),
**service tile** (link + live health checks via the server's LAN-only probe),
clock, and a utility placeholder. Docker packaging included. See
[PLAN.md](PLAN.md) for the full roadmap.

## Prerequisites

- Node.js ≥ 22
- npm ≥ 10

## Setup

```bash
git clone <repo-url> rackio && cd rackio
npm install
cp .env.example .env   # adjust if needed
```

## Development

```bash
npm run dev        # Vite (http://localhost:5173) + API server (:8787) together
npm run dev:web    # frontend only
npm run dev:server # API server only
```

The Vite dev server proxies `/api/*` to the API server, so the app is used via
http://localhost:5173 in development.

## Build, test, lint

```bash
npm run build      # typecheck + production bundle → dist/
npm run start      # serve dist/ + API from one process (production mode)
npm test           # vitest, single run
npm run test:watch # vitest, watch mode
npm run lint       # eslint
npm run typecheck  # tsc across app, server, and tooling configs
```

`node scripts/screenshot.mjs` captures dark/light/mobile screenshots of a
running instance; `node scripts/smoke-board.mjs` drives the board headlessly
(drag, footprints, settings, catalog, persistence) and fails on regressions.
Both take `BASE_URL` to point elsewhere and `CHROMIUM_PATH` to reuse a cached
Chromium build.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API/production server port |
| `HOST` | `0.0.0.0` | Bind address (all interfaces — rackio is a LAN app) |
| `DATA_DIR` | `data` | Where `board.json` lives; mount a volume here in Docker/k8s |
| `NODE_ENV` | — | `production` makes the server serve `dist/` |

### API

- `GET /api/health` — liveness
- `GET /api/board` / `PUT /api/board` — board state (JSON file on disk)
- `GET /api/ping?url=` — health probe for service tiles; refuses targets that
  don't resolve to a private/LAN address (incl. the 100.64/10 tailnet range)
- `GET /api/weather?lat=&lon=` — Open-Meteo proxy, cached 10 min per location
- `GET /api/geocode?q=` — Open-Meteo place search for the weather card

Service integration secrets (Calibre-Web credentials, etc.) arrive with their
milestones and will be documented in `.env.example` as they land. Secrets live
in `.env` (gitignored) — never in source.

## Project structure

```
src/            React SPA
  app/          shell: topbar, theme, icons, announcer, shared controls
  board/        grid engine, card frame, settings overlay, catalog, board state
  cards/        card registry + one folder per card type (clock, utility)
  styles/       design tokens (oklch, dark/light) + Tailwind setup
server/         Hono API server; serves dist/ in production
  connectors/   one file per integration (ping; weather and calibre to come)
shared/         types + zod schemas shared by SPA and server
scripts/        dev utilities (screenshots, board smoke test)
data/           runtime state (gitignored; board.json)
```

## Deployment

```bash
docker build -t rackio .
docker run -d -p 8787:8787 -v rackio-data:/app/data rackio
# or: docker compose up -d
```

Bare-metal: `npm run build` + `npm run start` runs the whole app from one
Node process. The final target is a Kubernetes cluster via a Helm chart (M5,
PVC-backed `/app/data`, secrets via values).
