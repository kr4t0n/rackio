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
    (`IconButton`, `CompactButton`).
  - `src/board/` — the board. M0 ships static chrome + placeholder cards; the
    react-grid-layout engine, footprints, and persistence land here in M1.
  - `src/cards/` (from M1) — card registry + one folder per card type. Cards
    implement the `CardDefinition` contract (see PLAN.md §3); the board never
    knows card internals.
  - `src/styles/tokens.css` — the design system. All theme-varying values are
    CSS custom properties on `:root` / `html[data-theme="light"]`, mapped to
    Tailwind utilities via `@theme inline`. Dark is the default theme.
- `server/` — Hono app run by `tsx` (no build step). Serves `/api`; in
  production also serves `dist/`. Connectors (one file per integration) land
  in `server/connectors/` from M2.
- `shared/` — types used by both sides (`Footprint`, `CardInstance`,
  `BoardState`). Import via relative path with explicit `.ts` extension (see
  gotchas).

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
- **Grid rows must be fixed height** (`auto-rows-[72px]`). `minmax(72px,auto)`
  rows stretch to fill the section's `min-height` and cards balloon. M1
  replaces the fixed 72px with a ResizeObserver-computed square cell:
  `(width − 11·gap) / 12`.
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

- Reset-board control returns with M1 (needs board state to reset).
- Server has no tests yet (meaningful once `/api/board` lands in M2).
- `start` script runs TS via `tsx` in production; fine for homelab scale,
  revisit for a leaner image in M5.
