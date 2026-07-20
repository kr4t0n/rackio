# Rackio — Project Plan

A personal dashboard for services running on the home rack. Grid-based board where
cards (one per service/integration) can be dragged into a custom layout. Every card
supports three responsive footprints: **small** (2×2), **big** (4×4), **wide** (4×2).

The uploaded demo (`.argus/uploads/…rackio-weather-dashboard-v13.html`) is the design
north star: oklch token system with dark/light themes, blueprint-grid board background,
frosted topbar, Three.js shader weather scene, Calibre "continue reading" card.

---

## 1. Product scope (v1)

- **Board**: 12-column grid, square cells sized from container width, 16px gap,
  blueprint-grid background. Cards drag by handle, snap to grid, vertical compaction.
  Layout persists and survives reloads. "Reset board" restores defaults.
- **Card footprints**: each card renders a tailored layout per footprint
  (not just scaled) — exactly like the demo's small/large/wide variants.
  Footprint is a per-card setting, not global (the demo's global segmented control
  was a prototype affordance only).
- **Edit vs. view mode**: view mode is clean — no chrome. Toggling edit mode reveals
  per-card affordances on the card frame:
  - **drag handle** (move), **remove**, **footprint switcher** (small / big / wide),
  - a **settings gear in the top-right corner** — clicking it opens the card's
    settings via **flip-to-center**: the card lifts out of the grid and flips
    mid-flight into a centered settings panel at a fixed size (~480px, footprint-
    independent) over a blurred backdrop; save/cancel flips it back into its slot.
    One consistent settings surface at any card size, while the animation preserves
    the card's identity (it's *that card* turning over, not a generic dialog).
    Settings content per type: weather → location search; service tile →
    name/URL/icon; calibre → shelf choice.
    Implementation: overlay portal + framer-motion shared-element flip (sidesteps
    react-grid-layout transform conflicts entirely); `prefers-reduced-motion` gets a
    plain fade-in dialog. Built as a functional centered dialog first, flip animation
    added as a polish layer on the same DOM.
  - Each card type ships its own settings component (validated by its zod config
    schema) — hand-built forms rather than auto-generated, for polish.
- **Card catalog**: an "Add card" drawer listing available card types; adding creates
  an instance with default config + footprint.
- **First-party cards**:
  1. **Weather** — the Three.js scene from the demo, driven by live data; location is
     per-card config (search box on the back face → Open-Meteo geocoding).
  2. **Calibre-Web** — recent books + continue reading, deep links into Calibre-Web.
  3. **Service tile** — generic link/status card for any rack service (name, icon,
     URL, up/down via backend health ping). This is what makes the board immediately
     useful for the whole rack (Home Assistant, Plex, and the rest) while richer
     cards are built one by one.
- **Rich-card roadmap (post-v1)**: Home Assistant (WebSocket API — entity states,
  scenes) and Plex (now playing / recently added) are the strongest candidates among
  the rack's services; both have good APIs and fit the wide footprint naturally.
- **Theming**: dark/light via the demo's oklch tokens; toggle in topbar, persisted.
- **Mobile (≤720px)**: stacked column (demo behavior), drag disabled.
- **Non-goals for v1**: multi-user/auth (**LAN-only confirmed**; reverse-proxy auth is
  the future path if ever exposed), multiple boards, card marketplace.

## 2. Stack

Per global standards: **TypeScript + React + Tailwind + Vite + ESLint (flat config)**.

| Concern | Choice | Why |
|---|---|---|
| Frontend | Vite + React 19 + TS | standard toolchain |
| Styling | Tailwind v4 + demo's oklch tokens as CSS variables | tokens port 1:1 from the demo; utilities everywhere else |
| Grid/drag | **react-grid-layout** | vetted, battle-tested (Grafana-class usage); drag-by-handle, collision/compaction, px rowHeight for square cells. We disable free resize and drive w/h from the three footprints |
| Data fetching | TanStack Query | polling, caching, retries for service data |
| 3D | three.js | direct port of the demo scene |
| Motion | framer-motion | flip-to-center settings transition, edit-mode affordance animations; respects reduced-motion |
| Validation | zod | card config schemas, API payloads |
| Backend | **Hono** on Node | one small server: serves built SPA + `/api`; tiny, typed, fast |
| Persistence | JSON file on server (`data/board.json`) | single-user homelab; survives browsers/devices; no DB needed — see the storage decision below |
| Testing | Vitest (+ RTL), Playwright later if needed | |
| Deploy | Docker multi-stage image; **Helm chart** for the final target (Kyle's k8s cluster); compose example for quick runs | one image serves both |

Why a backend at all: service integrations (Calibre-Web credentials, health pings to
LAN hosts, API caching) can't live in the browser — CORS and secrets. The server is
the single place that talks to rack services; the SPA only talks to `/api`.

### Storage decision: no database (decided 2026-07-20 with Kyle)

Considered introducing Postgres for card/position data ahead of more cards.
**Decision: no.** The board is a few KB, read/written as a whole document, with no
server-side queries, no relations, and one writer in practice — a pattern JSON files
serve perfectly. Atomicity (temp-file + rename, serialized writes) and conflict
resolution (`updatedAt` newer-wins, which is app-level logic a DB wouldn't replace)
already exist. On the cluster, Postgres would add a StatefulSet/operator, secret
plumbing, migrations, and backup jobs — real operational surface for zero query
value, and a new way for the dashboard to be down.

Storage stays behind the `BoardStore` / `ConnectionStore` interfaces, so upgrading
later is a one-file swap, not a rewrite. The escalation ladder:

1. **JSON on the data volume** (now, through M5) — backup is copying a file.
2. **SQLite** — when genuine row-shaped data arrives: history/time-series features
   (service-tile uptime graphs, weather trends), multiple boards, or board undo.
   Still one file on the same PVC, transactional, zero new infrastructure.
3. **Postgres** — only if rackio ever runs multiple replicas (shared mutable state)
   or becomes genuinely multi-user. Neither is planned; a single-replica dashboard
   that restarts in seconds does not need HA.

Rule for new cards: don't add per-card storage ad hoc — live data stays in memory
caches or `data/` files (like covers), and anything row-shaped triggers rung 2.

## 3. Architecture

```
rackio/
├── src/                      # React SPA
│   ├── app/                  # shell: topbar, theme, edit-mode state
│   ├── board/                # grid engine wrapper, footprint logic, persistence hooks
│   ├── cards/
│   │   ├── registry.ts       # card type registry (the extension point)
│   │   ├── weather/          # WeatherCard + scene/ (three.js port)
│   │   ├── calibre/
│   │   └── service-tile/
│   ├── lib/                  # api client, query hooks
│   └── styles/tokens.css     # oklch tokens (verbatim from demo)
├── server/
│   ├── index.ts              # Hono: static + /api mount
│   ├── connectors/           # weather.ts, calibre.ts, ping.ts — one per integration
│   └── store.ts              # board.json read/write (atomic)
├── shared/                   # types shared by SPA and server (Footprint, CardInstance, BoardState)
├── data/                     # runtime state (gitignored): board.json
├── .env.example              # CALIBRE_BASE_URL, CALIBRE_USER, CALIBRE_PASSWORD, …
├── .github/workflows/ci.yml  # lint + typecheck + test + build
└── Dockerfile, compose.yaml
```

Single npm package (no workspaces yet) — `shared/` wired via tsconfig paths. Dev:
`vite dev` on :5173 proxying `/api` → Hono on :8787. Prod: one Node process.

### Card contract (the heart of the project)

```ts
interface CardDefinition<C> {
  type: string;                          // 'weather' | 'calibre' | 'service-tile' | …
  name: string;
  footprints: Footprint[];               // subset of 'small' | 'big' | 'wide'
  defaultFootprint: Footprint;
  configSchema: ZodSchema<C>;
  Component: React.FC<{ config: C; footprint: Footprint; instanceId: string }>;
}
```

- Board stores only `CardInstance[]`: `{ id, type, config, footprint, x, y }`.
- The board never knows card internals; cards never know grid internals. Adding a new
  integration = one folder in `src/cards/` + optionally one file in `server/connectors/`.
- Footprint-specific layout via a `data-size` attribute + container queries / conditional
  JSX — same technique as the demo.

### Server API (v1)

- `GET/PUT /api/board` — board state (atomic write to `data/board.json`)
- `GET /api/weather?lat&lon` — Open-Meteo proxy, cached ~10 min, maps WMO codes →
  scene mode (`clear | rain | storm | snow`; cloudy/fog map onto nearest scene);
  lat/lon come from each weather card's own config
- `GET /api/geocode?q=` — Open-Meteo geocoding proxy for the weather card's
  location search on its settings back face
- `GET /api/calibre/recent` — recent/reading books via Calibre-Web OPDS (basic auth
  from `.env`), incl. proxied cover images
- `GET /api/ping?target=<service-id>` — health check for service tiles (targets come
  from server config, **not** from client input — no open proxy/SSRF)

## 4. Milestones

Each milestone ends green (lint, typecheck, tests) and visually verified via
screenshot on the dev stack.

**M0 — Foundation (skeleton on screen)** ✅ *(done 2026-07-19)*
Scaffold (Vite react-ts, Tailwind v4, ESLint flat, Vitest, Hono, git init +
conventional commits), port oklch tokens, build app shell: topbar (brand, board name,
reset, theme toggle), board chrome (blueprint background, heading), theme persistence.
README + AGENTS.md + CI from day one.

**M1 — Board engine (the core interaction)** ✅ *(done 2026-07-19; "reset
board" dropped — demo-only affordance. Shipped with clock + utility cards and
a headless smoke test, `scripts/smoke-board.mjs`.)*
react-grid-layout integration: square-cell rowHeight from ResizeObserver, drag by
handle only, three footprints per card frame, add/remove cards, edit mode, catalog
drawer, reset. **Settings surface**: settings gear → centered settings panel
(overlay portal) rendering the card type's settings component (placeholder form for
now); flip-to-center animation layered on once functional. Persistence to
localStorage first (server sync lands in M2 with the same `BoardState` shape).
Placeholder cards for content. Mobile stacked fallback. aria-live announcements for
board changes (demo pattern).
*Acceptance*: layouts survive reload; footprint switch reflows neighbors correctly;
settings open/save/cancel works from all three footprints.

**M2 — Server + service tiles (first real value)** ✅ *(done 2026-07-20.
Service URLs are card config edited in the UI rather than server config — the
ping connector enforces private-address-only targets instead, which is both
the SSRF guard and the product semantic. Board conflict resolution:
`updatedAt` newer-wins between localStorage cache and server.)*
Hono server, `/api/board` (persistence moves server-side), ping connector,
generic service-tile card in all three footprints. Docker build. From here
the board is genuinely useful for the rack.

**M3 — Weather card** ✅ *(done 2026-07-20. Scene ported verbatim except one
GLSL fix — `active` is reserved in WebGL2. Added a fifth `cloudy` scene mode
for overcast/fog. three.js is code-split out of the main bundle;
`maxInstances: 1` caps WebGL contexts via the catalog.)*
Port the demo's Three.js scene (sky/cloud/mist shaders, rain/snow particles) into a
React-managed lifecycle. Open-Meteo connector for live data; location picker
(geocoding search) on the settings back face. Reduced-motion + WebGL-unavailable
fallback = static gradient scene (demo already has this pattern). All three
footprints per the demo's layouts.

**M4 — Calibre-Web card** ✅ *(done 2026-07-20. Discovery: Kyle's instance is
https://book.kubitnodes.com; OPDS requires basic auth (401 anonymous) and
reading progress is not exposed → progress bar dropped as planned; card ships
"latest additions"/"popular now" shelves + deep links. Connection config in
`.env`; covers proxied server-side. `scripts/mock-calibre.mjs` fakes the
catalog for development.)*
Discovery task first: verify OPDS endpoints + whether reading progress is exposed on
Kyle's instance (progress may be Kobo-sync-only — if unavailable, ship
"recently added/read" and deep links, drop the % bar). Then connector + card in all
three footprints, cover proxying, deep links into Calibre-Web.

**M5 — Ship on the cluster**
Final deploy target is Kyle's k8s cluster: **Helm chart** (Deployment, Service,
optional Ingress, **PVC for `/data`** so `board.json` survives pod restarts, values
for env/secrets — Calibre creds via Secret). Also compose.yaml for quick non-cluster
runs, deployment docs, polish pass (motion, focus states, empty states), Playwright
smoke test if warranted.

## 5. Risks & gotchas

- **react-grid-layout keyboard a11y**: drag is pointer-only. Mitigation: "move
  left/right/up/down" actions in the card's edit menu.
- **WebGL context limit** (~8–16 per page): multiple weather cards or future WebGL
  cards could exhaust contexts. v1: allow one weather card instance; note shared
  renderer as the future fix.
- **Calibre-Web progress API** is undocumented/uncertain → explicit discovery task in
  M4, card designed to degrade gracefully.
- **Square-cell math**: rowHeight must track container width exactly (demo formula:
  `(width − 11·gap) / 12`) or footprints stop being square — one hook, unit-tested.
- **Flip-to-center animation**: settings render in an overlay portal (avoids
  react-grid-layout transform/z-index conflicts by construction). Pause the weather
  card's render loop while its settings are open. If the shared-element flip proves
  fiddly, the fallback is the same panel with a plain fade — zero rework.
- **Tailwind version note**: standards mention `tailwind.config.ts`; Tailwind v4 is
  CSS-first (`@theme`). Using v4 idioms — tokens live in CSS, which also matches the
  demo's variable-driven theming.

## 6. Resolved decisions (2026-07-19)

1. Rack runs many services incl. **Home Assistant and Plex** → service tiles cover
   them in v1; HA and Plex are the first rich-card candidates after Calibre.
2. **LAN-only, no auth** for v1.
3. **Weather location is per-card config** (location search on the back face).
4. **All card settings are per-card**, edited via the edit-mode gear (top-right
   corner) → **flip-to-center settings panel**: the card flips out of the grid into
   a centered, fixed-size panel — consistent settings experience at every footprint
   (chosen over an in-place back face, which is too cramped at 2×2).
5. Docker image is the packaging; **Helm chart is the deployment** — the final
   target is the k8s cluster (M5).
