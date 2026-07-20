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
    board never knows card internals. Current types: `weather`, `calibre`,
    `service-tile`, `clock`, `utility`.
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
- **Deployment target** is a k8s cluster via Helm (M5); Docker is packaging.

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

- **Theme**: `html[data-theme]` drives every color via CSS vars. An inline
  script in `index.html` applies the persisted theme pre-paint (no FOUC) —
  keep it in sync with `src/app/theme.ts` (`rackio-theme` localStorage key).
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
- **`sceneMode: "cloudy"` reuses the rain palette without particles** — the
  reference design had four scenes; overcast/fog map onto the rain look with
  `rain.visible = false` (see `MODE_UNIFORM` in engine.ts).
- **Calibre-Web has no reading-progress API** (progress is Kobo-sync-only),
  so the reference design's progress bar was deliberately dropped — the card
  ships shelves ("new"/"hot" OPDS feeds) + deep links. Don't fake a % bar.
- **Calibre connection is configured from the card's settings UI**, but the
  credentials are stored server-side in `DATA_DIR/connections.json` (0600) —
  never in board.json, which syncs to every client. `PUT
  /api/calibre/connection` validates against the live library and only
  persists working credentials; `GET` returns a sanitized status (no
  password). `CALIBRE_*` env vars override the UI (deployment-managed mode —
  the form shows "managed by the server environment"). Covers are proxied
  through `/api/calibre/cover/:id` so the browser never sees the basic-auth
  header. Kyle's instance: https://book.kubitnodes.com.
  `scripts/verify-connect.mjs` drives the whole flow headlessly against the
  authed mock (`MOCK_USER=… MOCK_PASSWORD=… node scripts/mock-calibre.mjs`).
- **`scripts/mock-calibre.mjs`** fakes the OPDS catalog (books + SVG covers,
  optional basic auth) — use it with `CALIBRE_BASE_URL=http://localhost:8093`
  to develop the card without touching the real library.
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
