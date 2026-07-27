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

**Status**: post-M4 card expansion — the board is playable and useful: edit mode,
drag by handle on a square-cell 12-column grid, per-card footprint switching,
an "Add card" catalog, per-card settings in a flip-to-center panel. The
layout persists **server-side** (`data/board.json`) with newer-wins conflict
resolution against the localStorage cache. Card types: **weather** (live
Open-Meteo conditions rendered as an animated WebGL sky, with a location
picker in settings), **adguard** (DNS blocking stats with an interactive
hourly sparkline, top blocked domains, and per-client breakdown from AdGuard
Home's API), **downloader** (live transfer queue and throughput from
qBittorrent or Transmission — one card per client, so several can sit on the
board at once), **plex** (continue-watching hero plus queue from a Plex
server — the queue backfills from recently added, since most servers only
have one thing in progress — with proxied artwork and deep links into the
Plex web app), **docker hub** (images in a namespace with the tag worth
pulling, and a detail sheet carrying digest, size, architectures and a
copyable pull command — public namespaces need no credentials, and a per-card
toggle switches between the newest release and the newest build for projects
you're actively pushing to),
**calendar** (month view, 12-day strip, and upcoming
agenda from an iCal subscription configured in settings — recurrences
expanded server-side), **calibre library** (fresh reads from Calibre-Web's
OPDS catalog with proxied covers and deep links; connect from the card's
settings — credentials are validated then stored server-side, never in the
board), **service tile** (link + live health checks via the server's
LAN-only probe), and **time** (local clock with day progress plus up to four
world clocks). Docker packaging included. See
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

### Shell modes

The SPA renders two shells, selected by the `shell` query parameter:

| URL | Shell | What it is |
| --- | --- | --- |
| `/` | `app` | The normal dashboard — topbar, blueprint background, edit mode. |
| `/?shell=wallpaper` | `wallpaper` | Transparent, chrome-less, read-only. Cards only. |

The wallpaper shell exists for the macOS desktop app (see below). It never
writes the board back to the server; it polls `/api/board` once a minute so
edits made in a browser reach it. Open it in a browser any time to see what
the desktop app renders.

## macOS desktop app

`mac/` is a small AppKit app that puts the live board on your desktop
wallpaper — a transparent `WKWebView` pinned to the desktop window level,
loading this same SPA with `?shell=wallpaper`. It is a viewer: the rackio
server keeps running on the rack, and the Mac is just another client.

```bash
cd mac
./build.sh --run     # needs the Xcode command line tools
```

It runs as a status bar item (no Dock icon); point it at your rackio host from
**Board URL…**. See [mac/README.md](mac/README.md) for the status menu, how the
desktop-level window works, and the known limitations.

Note this is *not* a WidgetKit widget — those are SwiftUI-only and cannot run
a web view, so the animated cards could not exist in one. `mac/README.md`
explains the trade-off.

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
(drag, footprints, settings, catalog, persistence) and fails on regressions —
point it at a production-mode server (`npm run start`, :8791 by default).
Both take `BASE_URL` to point elsewhere and `CHROMIUM_PATH` to reuse a cached
Chromium build.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API/production server port |
| `HOST` | `0.0.0.0` | Bind address (all interfaces — rackio is a LAN app) |
| `DATA_DIR` | `data` | Where `board.json` lives; mount a volume here in Docker/k8s |
| `NODE_ENV` | — | `production` makes the server serve `dist/` |
| `HTTPS_PROXY` / `HTTP_PROXY` | — | Egress proxy for the Docker Hub card (also `ALL_PROXY`; lowercase spellings win, as in curl) |
| `NO_PROXY` | — | Hosts that bypass the proxy; `*` disables it entirely |

The server loads `.env` automatically at startup (`process.loadEnvFile`).

Node ignores `HTTPS_PROXY` on its own, so rackio wires it up explicitly — and
only for **Docker Hub**, the one integration that leaves your rack. Calibre,
AdGuard, Plex, the calendar feed and torrent clients always connect directly,
so pointing rackio at an internet proxy can't break the cards that reach your
own services.

**Integrations are not configured through the environment.** Calibre,
the calendar feed, AdGuard, Plex, Docker Hub, and torrent clients are each
connected from their card's settings panel; the server validates the credentials against
the live service and stores them in `DATA_DIR/connections.json` (mode
0600), never in the board file.

### API

- `GET /api/health` — liveness
- `GET /api/board` / `PUT /api/board` — board state (JSON file on disk)
- `GET /api/ping?url=` — health probe for service tiles; refuses targets that
  don't resolve to a private/LAN address (incl. the 100.64/10 tailnet range)
- `GET /api/weather?lat=&lon=` — Open-Meteo proxy, cached 10 min per location
- `GET /api/geocode?q=` — Open-Meteo place search for the weather card
- `GET /api/calibre/books?source=new|hot` — Calibre-Web OPDS shelf, cached 5 min
- `GET /api/calibre/cover/:id` — cover image proxy (auth stays server-side)
- `GET/PUT/DELETE /api/calibre/connection` — connection status (sanitized) and
  UI-driven setup; PUT validates credentials against the library before saving
- `GET /api/calendar/events` — iCal feed events, recurrences expanded, cached 10 min
- `GET/PUT/DELETE /api/calendar/connection` — feed subscription (status exposes
  the host only, never the full URL)
- `GET /api/adguard/stats` — AdGuard Home totals, hourly series, and top lists,
  cached 1 min
- `GET/PUT/DELETE /api/adguard/connection` — instance setup, validated against
  the live API before saving
- `GET /api/plex/state` — Plex continue-watching queue, cached 30 s
- `GET /api/plex/art?path=&w=&h=` — artwork proxy (token stays server-side)
- `GET/PUT/DELETE /api/plex/connection` — server + token setup, validated
  against the live server before saving
- `GET /api/dockerhub/state` — images in a namespace, cached 10 min
- `GET/PUT/DELETE /api/dockerhub/connection` — namespace plus optional access
  token, validated against Docker Hub before saving
- `GET /api/downloader/:cardId/stats` — torrent client queue + throughput
  samples for one card
- `GET/PUT/DELETE /api/downloader/:cardId/connection` — per-card client setup;
  connections are pruned automatically when the card leaves the board

`node scripts/mock-calibre.mjs` runs a fake Calibre-Web OPDS server on :8093
for developing the calibre card without a real library;
`node scripts/mock-ical.mjs` serves a fixture ICS feed on :8094 for the
calendar card; `node scripts/mock-adguard.mjs` fakes the AdGuard Home API on
:8095; `node scripts/mock-downloader.mjs` fakes qBittorrent on :8097 (or
`KIND=transmission PORT=8098 …` for Transmission);
`node scripts/mock-plex.mjs` fakes a Plex server on :8099 (`ONDECK=1` to
mimic the usual single in-progress item).

## Project structure

```
src/            React SPA
  app/          shell: topbar, theme, icons, announcer, shared controls
  board/        grid engine, card frame, settings overlay, catalog, board state
  cards/        card registry + one folder per card type
  styles/       design tokens (oklch, dark/light) + Tailwind setup
server/         Hono API server; serves dist/ in production
  connectors/   one file per integration (ping, weather, calibre, calendar, adguard, downloader, plex, dockerhub)
shared/         types + zod schemas shared by SPA and server
scripts/        dev utilities (screenshots, board smoke test)
data/           runtime state (gitignored): board.json, connections.json, covers/
mac/            macOS wallpaper app (Swift/AppKit, builds with swiftc)
```

## Deployment

### Kubernetes (Helm)

The chart is published to GitHub Pages and the image to Docker Hub
(`kr4t0n/rackio`, multi-arch amd64 + arm64):

```bash
helm repo add rackio https://kr4t0n.github.io/rackio/helm
helm repo update
helm install rackio rackio/rackio --namespace rackio --create-namespace
```

That gives you a single replica with a 1Gi PVC mounted at `/app/data`
(board layout, integration credentials, cover cache) and a ClusterIP
Service. To expose it on a tailnet with the Tailscale operator:

```bash
helm install rackio rackio/rackio -n rackio --create-namespace \
  -f helm/rackio/examples/values.tailscale.yaml
```

Or behind your own ingress controller — the usual Helm shape, so several
hosts and paths work:

```yaml
ingress:
  enabled: true
  className: traefik
  annotations:
    traefik.ingress.kubernetes.io/router.tls.certresolver: dnspod
  hosts:
    - host: rackio.example.com
      paths:
        - path: /
          pathType: ImplementationSpecific
  tls:
    - hosts:
        - rackio.example.com
      # secretName: rackio-tls   # omit when the controller issues the cert
```

Key values (full list in [helm/rackio/values.yaml](helm/rackio/values.yaml)):

| Value | Default | Notes |
| --- | --- | --- |
| `image.tag` | `.Chart.AppVersion` | Pin a specific image |
| `persistence.enabled` / `size` | `true` / `1Gi` | PVC is kept on uninstall |
| `ingress.enabled` / `className` / `hosts` / `tls` | `false` | Standard Helm ingress schema (see below) |

Rackio reaches your services **from the pod**, so configured addresses
must be routable from inside the cluster. It runs as a non-root user
(uid 1000) with `fsGroup` making the volume writable.

### Docker

```bash
docker run -d -p 8787:8787 -v rackio-data:/app/data kr4t0n/rackio
# or, from a clone: docker compose up -d
```

Bare-metal: `npm run build` + `npm run start` runs the whole app from one
Node process.

### Releasing

* **Image** — pushes to `main` publish `:latest`, `:main`, `:sha-<short>`;
  pushing a `v*` tag publishes the semver tags too.
* **Chart** — bump `version:` in `helm/rackio/Chart.yaml` and merge to
  `main`; `helm-publish` packages it to the `gh-pages` branch. `helm
  package` refuses to overwrite an existing version, so the bump *is* the
  release.
* Only `docker-publish` needs repo secrets: `DOCKERHUB_USERNAME` /
  `DOCKERHUB_TOKEN`.
