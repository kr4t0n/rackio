# AGENTS.md — Rackio

Context for AI agents (and humans) contributing to this project. Read
[PLAN.md](PLAN.md) first — it is the roadmap and records the design decisions
with their rationale; this file covers how the codebase is put together.

## What this is

A single-user, LAN-only dashboard for services on a home rack. React SPA plus
a small Hono API server; the server is the only thing that talks to rack
services (secrets + CORS live server-side), the SPA only talks to `/api`.

## Architecture

- `src/` — Vite + React 19 + TypeScript + Tailwind v4 SPA.
  - `src/app/` — application shell: `Topbar`, theme system, shared controls
    (`IconButton`, `CompactButton`), icons, the aria-live `announce()` helper.
  - `src/board/` — the board engine. `Board.tsx` orchestrates (edit mode,
    catalog, settings, mobile stacked fallback); `BoardGrid.tsx` wraps
    react-grid-layout v2; `CardFrame.tsx` renders the card shell + edit
    affordances; `SettingsOverlay.tsx` is the flip-to-center settings panel;
    `state.ts` is a pure reducer; `useBoardState.ts` persists — the server
    (`/api/board`) is the source of truth, localStorage is a warm cache, and
    hydration keeps whichever side has the newer `updatedAt` (see gotchas).
  - `src/cards/` — card registry + one folder per card type. Cards implement
    the `CardDefinition` contract in `registry.tsx` (Component + Settings +
    zod config schema + supported footprints + optional `maxInstances`); the
    board never knows card internals. Current types: `weather`, `adguard`,
    `downloader`, `calendar`, `calibre`, `service-tile`, `clock` (the Time
    card — type key kept for board compatibility). The `utility` placeholder
    was removed once the real cards landed; boards that still reference it
    drop the card on load via `sanitizeBoardState`, which is the intended
    behaviour for any retired type.
  - `src/board/Sparkline.tsx` — shared activity chart (area + line, hover /
    keyboard crosshair and tooltip) used by adguard and downloader; callers
    supply value/label formatting.
  - `src/cards/weather/scene/` — the three.js sky: `shaders.ts` (GLSL ported
    from the reference design), `engine.ts` (plain TS class: renderer, cloud
    planes, rain/snow particles), `WeatherScene.tsx` (React lifecycle +
    gradient fallback). Lazy-loaded so three.js stays out of the main bundle.
  - `src/lib/api.ts` — typed client for `/api`; TanStack Query handles
    polling (service tile pings every 30s).
  - `src/styles/tokens.css` — the design system. All theme-varying values are
    CSS custom properties on `:root` / `html[data-theme="light"]`, mapped to
    Tailwind utilities via `@theme inline`. Dark is the default theme.
- `server/` — Hono app run by `tsx` (no build step; note `tsx` is a *runtime*
  dependency for this reason). Serves `/api`; in production also serves
  `dist/`. `store.ts` persists `board.json` (atomic temp-file + rename,
  serialized writes). `connectors/` holds one file per integration —
  `ping.ts` so far.
- `shared/` — types + zod schemas used by both sides (`Footprint`,
  `CardInstance`, `BoardState`, `board-schema.ts`). Import via relative path
  with explicit `.ts` extension (see gotchas).

## Key decisions (abbreviated — rationale in PLAN.md)

- **react-grid-layout** for the grid; free resize disabled — cards only take
  the three fixed footprints (small 2×2, big 4×4, wide 4×2).
- **Card settings** open via flip-to-center: overlay portal + framer-motion,
  never an in-grid flip (transform conflicts, 2×2 too cramped).
- **Persistence** is a JSON file on the server (single user, no DB).
- **No database — decided deliberately with Kyle (2026-07-20), don't
  reintroduce the idea per-card.** The board is KB-scale, whole-document
  read/write, zero server-side queries; a DB adds cluster ops (StatefulSet,
  secrets, migrations, backups) for no query value. Storage hides behind
  `BoardStore`/`ConnectionStore`, so upgrading is a one-file swap when — and
  only when — a rung on the ladder is reached: **JSON file → SQLite** (first
  row-shaped feature: uptime/weather history, multiple boards, undo) **→
  Postgres** (only for multi-replica or true multi-user, neither planned).
  New cards keep live data in memory caches or `data/` files (see covers);
  anything row-shaped means the SQLite rung, not an ad-hoc store.
- **Integration credentials are UI-only (decided 2026-07-25).** No
  environment variables, no chart values — see the gotcha below.
- **Deployment target** is a k8s cluster via Helm; Docker is packaging.
  Release pipeline mirrors the argus project: `docker-publish.yml`
  (multi-arch, native runners, push-by-digest then merge manifest) and
  `helm-publish.yml` (packages `helm/rackio` onto the `gh-pages` branch,
  served at https://kr4t0n.github.io/rackio/helm). Publishing a chart =
  bumping `version:` in Chart.yaml; `helm package` won't overwrite an
  existing tarball. Both need `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN`.

## Conventions

- TypeScript everywhere; ESLint flat config in `eslint.config.ts`; all code
  passes `npm run lint` and `npm run typecheck` before commit.
- Conventional Commits (`feat(board): …`, `fix(server): …`).
- Styling is Tailwind utilities in JSX against the token utilities
  (`bg-bg`, `text-fg`, `border-border`, `text-muted`, `bg-surface`,
  `text-accent`, `shadow-card`, `rounded-card`, `font-display`). Frosted
  surfaces use arbitrary values with `color-mix(in oklch, …)` — copy an
  existing example. Custom CSS only for things utilities can't express
  (e.g. the `board-blueprint` background in tokens.css).
- Components are function components; no default exports.
- Buttons must be ≥44px hit targets (`min-h-11`) and keep the shared
  hover/active/focus-visible behavior from `controls.tsx`.

## Gotchas

- **The chart is deliberately single-replica with `strategy: Recreate`** —
  rackio writes JSON state to a ReadWriteOnce volume from one process, so a
  second replica would race it and a RollingUpdate would deadlock waiting
  for the volume. Don't "helpfully" add `replicaCount`.
- **Container runs as non-root (uid 1000)** — hence `CMD` invokes
  `node_modules/.bin/tsx` directly: `npx` needs a writable HOME for its
  cache and dies under a restricted securityContext. The chart sets
  `fsGroup: 1000` so the mounted volume is writable.
- **The PVC carries `helm.sh/resource-policy: keep`** — uninstalling a
  release must not delete the board and saved credentials.

- **Theme**: `html[data-theme]` drives every color via CSS vars. An inline
  script in `index.html` applies the persisted theme pre-paint (no FOUC) —
  keep it in sync with `src/app/theme.ts` (`rackio-theme` localStorage key).
- **The board keeps a FIXED 12 columns; width is capped by
  `--board-max-width` (tokens.css), not by adding columns.** Extra screen
  width therefore makes cards bigger, not more numerous — at full ultrawide
  width a 2×2 tile passes 540px and its content floats. Columns can't vary
  with viewport while a single layout is stored: RGL clamps out-of-range x
  positions, `onLayoutChange` persists the clamped result, and opening the
  board on a narrower screen would permanently scramble the wide
  arrangement. Per-breakpoint layouts would be the prerequisite.
- **react-grid-layout v2** (not v1): config lives in `gridConfig` /
  `dragConfig` / `resizeConfig` objects, not flat props, and the package
  ships its own types plus a `useContainerWidth` hook (which drives the
  square-cell math: `(width − 11·gap) / 12`, see `grid-math.ts`).
- **Never put transforms on `.react-grid-item`** — RGL owns that transform.
  Visual effects (drag lift, flip) go on the inner `.card-frame` or in an
  overlay portal.
- **Never animate opacity on a `preserve-3d` element** (`SettingsOverlay`):
  opacity < 1 forces the browser to flatten the 3D context, which kills
  backface culling — the flip shows mirrored settings text instead of the
  card back. The fade lives on a wrapper shell (which also carries
  `perspective`); the flipping element keeps opacity 1 forever.
- **`set-positions` must be referentially stable when nothing moved**
  (`state.ts`): RGL fires `onLayoutChange` after every commit; returning a
  new state object each time would loop forever.
- **Edit mode fades card content** (`opacity-35` + `inert`) so affordances
  read clearly — edit chrome overlays content by design; don't "fix" overlap
  by moving card content around.
- **Pixel positions shift between edit and view mode** (the board-head hint
  text wraps differently) — compare stored board JSON, not bounding boxes,
  when asserting persistence.
- **Board conflict resolution is `updatedAt` newer-wins** (`useBoardState`):
  the debounced PUT can lose a race with the next page load's GET (observed
  on localhost — the reload GET beat the pagehide keepalive PUT, resurrecting
  a removed card). Every reducer mutation stamps `updatedAt`; hydration keeps
  the fresher of cache vs server. Don't "simplify" this to server-always-wins.
- **`/api/ping` only probes private addresses** (RFC1918, loopback,
  link-local, CGNAT 100.64/10 for the tailnet, private IPv6) — resolves the
  hostname first, then checks the IP. This is both the product semantic
  (rackio watches *local* services) and the SSRF guard; don't widen it.
  Any HTTP status < 500 counts as "up" (a 401 from Home Assistant means it's
  alive).
- **The smoke test resets state**: it clears localStorage AND PUTs a fixture
  board to `/api/board`. Never point it at a server whose board you care
  about — use a scratch `DATA_DIR`.
- **Rackio is used from insecure origins** — Kyle visits over plain HTTP on
  the tailnet IP, where `window.isSecureContext` is false and APIs like
  `crypto.randomUUID`, `navigator.clipboard`, and Web Crypto are missing.
  "Add card" was silently broken this way (localhost tests never catch it —
  localhost IS a secure context). Use `generateCardId()` from
  `src/board/state.ts`, never `crypto.randomUUID` directly, and when
  verifying UI flows headlessly, run at least one pass with
  `BASE_URL=http://100.90.0.0:<port>`.
- **Hydration must not echo-save**: `useBoardState` skips the server PUT when
  the state object is the very board the server just returned
  (`serverBoardRef` identity check). Without it every page load re-PUTs the
  board and the pagehide flush can clobber concurrent writers.
- **GLSL ES 3.0 reserves words that GLSL ES 1.0 didn't** — three.js r163+ is
  WebGL2-only, so shaders that ran in the WebGL1 demo can fail now (`active`
  bit us; also reserved: `filter`, `sample`, `buffer`, `precise`). A shader
  compile failure logs to console and renders black — check the browser
  console, not just the screenshot.
- **Weather card is capped at one instance** (`maxInstances: 1`) because each
  scene owns a WebGL context (browsers allow ~8-16 per page). The catalog
  disables Add at the cap. A shared-renderer refactor would lift this.
- **The weather scene is day/night aware via `isDay`** (Open-Meteo's
  `is_day`), threaded card → `WeatherScene` → engine as a `uNight` uniform
  that every shader mixes against: night palettes, a crescent moon in place
  of the sun, a hash-based star field on clear nights, darker cloud/mist
  lighting, and lower tone-mapping exposure. It eases over ~1s so
  sunrise/sunset glide rather than snap. The fallback gradients have night
  variants too — otherwise a WebGL-less client flashes a noon sky at
  midnight. Any new scene uniform must be added in `makeUniforms` so it
  reaches all layers.
- **`sceneMode: "cloudy"` reuses the rain palette without particles** — the
  reference design had four scenes; overcast/fog map onto the rain look with
  `rain.visible = false` (see `MODE_UNIFORM` in engine.ts).
- **Calibre-Web has no reading-progress API** (progress is Kobo-sync-only),
  so the reference design's progress bar was deliberately dropped — the card
  ships shelves ("new"/"hot" OPDS feeds) + deep links. Don't fake a % bar.
- **Integration credentials are UI-only, by explicit decision (2026-07-25).**
  Every connector is configured from its card's settings, validated against
  the live service, and stored server-side in `DATA_DIR/connections.json`
  (0600) — never in board.json, which syncs to every client. There is NO
  environment-variable path: don't add `CALIBRE_*` / `ADGUARD_*` /
  `CALENDAR_ICS_URL` style overrides back, and don't add chart values for
  them. `GET /…/connection` returns a sanitized status (no password; the
  calendar exposes only the feed's host). Calibre covers are proxied through
  `/api/calibre/cover/:id` so the browser never sees the basic-auth header.
  Kyle's instance: https://book.kubitnodes.com.
  `scripts/verify-connect.mjs` drives the whole flow headlessly against the
  authed mock (`MOCK_USER=… MOCK_PASSWORD=… node scripts/mock-calibre.mjs`).
- **The link to Kyle's Calibre-Web is very slow** (a 150KB cover was observed
  taking 37s) — naive parallel cover proxying times out en masse. `fetchCover`
  therefore: dedupes concurrent requests per id, limits upstream downloads to
  3 at a time, allows 60s per download, and caches covers in memory AND on
  disk (`DATA_DIR/covers/`) so each book's cover is fetched once ever.
  Resized-thumbnail web routes (`/cover/:id/sm`) 302 to login under basic
  auth, so full covers are the only option.
- **Downloader connections are PER CARD, not global** — Kyle runs several
  torrent clients, so `connections.json` holds `downloaders[<cardId>]` and
  every endpoint is `/api/downloader/:instanceId/…`. `CardSettingsProps` gains
  `instanceId` for exactly this. Two consequences to preserve: card ids are
  validated against `^[A-Za-z0-9_-]{1,64}$` before touching the store, and
  `PUT /api/board` **prunes connections whose card is gone** — otherwise
  deleting a card would orphan its credentials on disk forever.
- **Torrent client quirks**: qBittorrent needs a login round-trip whose `SID`
  cookie is cached (~25 min) and re-issued on 403; ETA `8640000` means
  "unknown". Transmission answers the first RPC call with **409 + a CSRF
  session id** that must be replayed — the retry is built into
  `transmissionRpc`. Neither client exposes a throughput history, so the
  server keeps an in-memory ring of download-rate samples per card and sends
  ages alongside for the chart's "30s ago" labels; the ring resets on
  restart by design (no DB — see the storage decision).
- **AdGuard = third connector on the same shape** (settings-UI connection →
  connections.json, validate-before-save with URL candidates so a pasted
  `#/dashboard` URL works). Stats come from
  `/control/stats` + `/control/status`; `avg_processing_time` is *seconds* in
  current builds (values < 1 are converted to ms), and top-lists arrive as
  either `{domain: count}` or `{name, count}` depending on version — both are
  parsed. `scripts/mock-adguard.mjs` serves a fixture API on :8095.
- **Charts must not set a tall `min-height`** — the AdGuard sparkline
  overflowed its panel and painted over the stats row/axis on a narrow board.
  Keep the floor tiny (24px), put `min-h-0` on the grid item wrapping it, and
  gate optional chrome (axis labels, mini-stat rows) behind container queries.
- **Calendar = iCal subscription, same secrecy rules as calibre**: private
  ICS URLs are capability tokens, stored in connections.json via the card's
  settings; the status endpoint returns the HOST only, never the full URL. Recurrence expansion happens server-side
  (node-ical), windowed to −1/+60 days, capped at 100 events.
  `scripts/mock-ical.mjs` serves a fixture feed on :8094 for development.
- **The Time card keeps type key `clock`** so existing board instances
  upgrade in place — old `{label,use24h,showSeconds}` configs fail the new
  schema and reset to defaults by design (resolveConfig fallback).
- **Wide-footprint two-column bodies need `grid-rows-[minmax(0,1fr)]`**:
  without an explicit row track the implicit row sizes to content and tall
  columns overflow the card (bit the Time card's world clocks). Same family
  as the M0 fixed-row-height gotcha.
- **Users paste address-bar URLs** — Kyle's first connect saved
  `…/login?next=%2F` as the base URL, and Calibre-Web answered feed requests
  under it with the login page (HTTP 200 + HTML), which passed the original
  "no error status" validation with zero books. Connection PUT now walks
  `baseUrlCandidates()` (strips query/login/opds paths, falls back to
  origin, preserves sub-path mounts) and requires `parseOpdsDocument` to see
  a real Atom feed; a 200 that isn't a feed is `error: "not-opds"`. Any
  future connector validation should assert on parsed content, not status
  codes.
- **`scripts/mock-calibre.mjs`** fakes the OPDS catalog (books + SVG covers,
  optional basic auth) — point the card's settings at http://localhost:8093
  to develop against it without touching the real library.
- **`pkill -f 'server/index.ts'` kills your own compound command** if the
  pattern appears anywhere in it (bash -c argv matches). Use
  `pkill -f 'server/index[.]ts'` in a Bash call that doesn't also spawn the
  server.
- **tsconfig layout**: three referenced projects (`app`, `node` for
  vite/eslint configs, `server`), all `noEmit` — nothing is compiled to JS;
  `tsx` runs the server directly. `shared/` is included by both `app` and
  `server`, so it must satisfy both `bundler` and `nodenext` resolution →
  imports of shared files use explicit `.ts` extensions.
- **eslint-plugin-react-hooks v7**: flat configs live at
  `reactHooks.configs.flat['recommended-latest']` — the top-level
  `configs['recommended-latest']` is the legacy format and breaks flat config.
- **playwright is pinned exact** (`1.61.1`) to match the Chromium build cached
  in `~/.cache/ms-playwright` (1223). Bumping playwright requires
  `npx playwright install chromium-headless-shell` or passing
  `CHROMIUM_PATH` to `scripts/screenshot.mjs`.
- `.argus/` is a chat-upload directory (contains the original design
  reference HTML) — gitignored, don't touch.

## Verifying changes

`npm run lint && npm run typecheck && npm test && npm run build`, then for
anything visual: `npm run start` (or `npm run dev`) and
`node scripts/screenshot.mjs` to eyeball dark/light/mobile. The bar for visual
polish is high — compare against the reference design in `.argus/uploads/`.

## Tech debt / planned

- Card drag is pointer-only; keyboard move actions (via card menu) are a
  planned follow-up.
- "Reset board" from the reference design was deliberately dropped (Kyle:
  demo-only affordance) — don't reintroduce it.
- Service-tile icons are auto-monograms; real service icons (or a picker)
  could come later.
- `start`/Docker run TS via `tsx` in production; fine for homelab scale,
  revisit for a leaner compiled image in M5.
