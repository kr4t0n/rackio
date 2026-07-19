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

**Status**: M0 (foundation) — app shell, theming, API server, and tooling are
in place. The board engine (drag, footprints, persistence) lands in M1. See
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
running instance (`BASE_URL` to point elsewhere, `CHROMIUM_PATH` to reuse a
cached Chromium build).

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API/production server port |
| `NODE_ENV` | — | `production` makes the server serve `dist/` |

Service integration secrets (Calibre-Web credentials, etc.) arrive with their
milestones and will be documented in `.env.example` as they land. Secrets live
in `.env` (gitignored) — never in source.

## Project structure

```
src/            React SPA
  app/          shell: topbar, theme, shared controls
  board/        board chrome; grid engine lands here in M1
  styles/       design tokens (oklch, dark/light) + Tailwind setup
server/         Hono API server; serves dist/ in production
shared/         types shared by SPA and server (footprints, board state)
scripts/        dev utilities (screenshots)
data/           runtime state (gitignored; server-persisted board from M2)
```

## Deployment

Planned for M5: Docker image plus a Helm chart targeting a Kubernetes cluster
(PVC-backed `/data`, secrets via values). Until then, `npm run build` +
`npm run start` runs the whole app from one Node process.
