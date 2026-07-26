import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { z } from "zod";
import { validateBoardState } from "../shared/board-schema.ts";
import { createConnectionStore } from "./connection-store.ts";
import {
  adguardBaseCandidates,
  clearAdguardCache,
  fetchStats,
  getStats,
  initAdguard,
  resolveAdguardConnection,
} from "./connectors/adguard.ts";
import {
  clearDockerHubCache,
  clearDockerHubToken,
  fetchDockerHub,
  getDockerHubState,
  initDockerHub,
  normalizeNamespace,
  resolveDockerHubConnection,
} from "./connectors/dockerhub.ts";
import {
  clearDownloaderState,
  fetchDownloader,
  getDownloaderStats,
  initDownloader,
  normalizeBaseUrl,
  resolveDownloader,
} from "./connectors/downloader.ts";
import {
  clearPlexArtCache,
  clearPlexCache,
  fetchPlex,
  fetchPlexArt,
  getPlexState,
  initPlex,
  isPlexArtPath,
  normalizePlexUrl,
  resolvePlexConnection,
} from "./connectors/plex.ts";
import {
  clearCalendarCache,
  fetchFeed,
  getFeed,
  initCalendar,
  normalizeIcsUrl,
  resolveCalendarUrl,
} from "./connectors/calendar.ts";
import {
  baseUrlCandidates,
  clearCalibreCache,
  fetchCover,
  fetchShelf,
  getShelf,
  initCalibre,
  resolveConnection,
} from "./connectors/calibre.ts";
import { assertSafeTarget, probe } from "./connectors/ping.ts";
import { geocode, getWeather } from "./connectors/weather.ts";
import { createBoardStore } from "./store.ts";

// Load .env if present, for local overrides of PORT/HOST/DATA_DIR.
// Integration credentials are NOT read from the environment: every card is
// connected from its own settings UI (see AGENTS.md).
try {
  process.loadEnvFile();
} catch {
  // No .env file — configuration comes from the process environment.
}

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 8787);
// Bind all interfaces — rackio is reached over the LAN/tailnet, not just localhost.
const hostname = process.env.HOST ?? "0.0.0.0";

const dataDir = process.env.DATA_DIR ?? "data";
const store = createBoardStore(dataDir);
const connections = createConnectionStore(dataDir);
initCalibre(connections, dataDir);
initCalendar(connections);
initAdguard(connections);
initDownloader(connections);
initPlex(connections);
initDockerHub(connections);

const api = new Hono();

api.get("/health", (c) =>
  c.json({ status: "ok", service: "rackio", uptime: process.uptime() }),
);

api.get("/board", async (c) => {
  const board = await store.load();
  return c.json({ board });
});

api.put("/board", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const board = validateBoardState(body);
  if (!board) return c.json({ error: "invalid board state" }, 400);
  if (board.cards.length > 200) {
    return c.json({ error: "too many cards" }, 400);
  }
  await store.save(board);
  // Card secrets outlive their card otherwise — drop connections for cards
  // that are no longer on the board.
  const stale = await connections.pruneDownloaders(
    board.cards.map((card) => card.id),
  );
  for (const id of stale) clearDownloaderState(id);
  return c.json({ board });
});

api.get("/weather", async (c) => {
  const lat = Number(c.req.query("lat"));
  const lon = Number(c.req.query("lon"));
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return c.json({ error: "valid lat and lon query parameters required" }, 400);
  }
  try {
    return c.json(await getWeather(lat, lon));
  } catch (error) {
    console.warn("weather fetch failed:", error);
    return c.json({ error: "weather service unavailable" }, 502);
  }
});

api.get("/geocode", async (c) => {
  const query = (c.req.query("q") ?? "").trim();
  if (query.length < 2) return c.json({ matches: [] });
  try {
    return c.json({ matches: await geocode(query) });
  } catch (error) {
    console.warn("geocode failed:", error);
    return c.json({ error: "geocoding service unavailable" }, 502);
  }
});

api.get("/calibre/books", async (c) => {
  const source = c.req.query("source") === "hot" ? "hot" : "new";
  return c.json(await getShelf(source));
});

// Connection status, sanitized — the password never leaves the server.
api.get("/calibre/connection", async (c) => {
  const connection = await resolveConnection();
  if (!connection) return c.json({ configured: false });
  return c.json({
    configured: true,
    baseUrl: connection.baseUrl,
    user: connection.user,
  });
});

const calibreConnectionSchema = z.object({
  baseUrl: z
    .url()
    .max(200)
    .refine((u) => u.startsWith("http://") || u.startsWith("https://"), {
      message: "baseUrl must be http(s)",
    }),
  user: z.string().min(1).max(100),
  password: z.string().max(200),
});

// Validate against the live library first; only working credentials persist.
api.put("/calibre/connection", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const parsed = calibreConnectionSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid connection details" }, 400);

  // People paste whatever their address bar shows (login pages, /opds, query
  // strings) — try normalized candidates and save the first that serves a
  // real OPDS feed with these credentials.
  let lastError: "unauthorized" | "unreachable" | "not-opds" = "unreachable";
  for (const baseUrl of baseUrlCandidates(parsed.data.baseUrl)) {
    const candidate = { ...parsed.data, baseUrl };
    const shelf = await fetchShelf(candidate, "new");
    if (!shelf.error) {
      await connections.saveCalibre(candidate);
      clearCalibreCache();
      return c.json({ ok: true, books: shelf.books?.length ?? 0 });
    }
    // Unauthorized beats not-opds beats unreachable as the reported reason.
    if (
      shelf.error === "unauthorized" ||
      (shelf.error === "not-opds" && lastError === "unreachable")
    ) {
      lastError = shelf.error;
    }
  }
  return c.json({ ok: false, error: lastError });
});

api.delete("/calibre/connection", async (c) => {
  await connections.clearCalibre();
  clearCalibreCache();
  return c.json({ ok: true });
});

api.get("/calibre/cover/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 0) {
    return c.json({ error: "invalid cover id" }, 400);
  }
  const cover = await fetchCover(id);
  if (!cover) return c.json({ error: "cover unavailable" }, 404);
  return c.body(cover.body, 200, {
    "Content-Type": cover.contentType,
    "Cache-Control": "public, max-age=3600",
  });
});

api.get("/calendar/events", async (c) => c.json(await getFeed()));

// Sanitized status: private ICS URLs are capability tokens — expose the host
// only, never the full URL.
api.get("/calendar/connection", async (c) => {
  const connection = await resolveCalendarUrl();
  if (!connection) return c.json({ configured: false });
  let host = "calendar feed";
  try {
    host = new URL(connection.url).host;
  } catch {
    // keep the generic label
  }
  return c.json({ configured: true, host });
});

api.put("/calendar/connection", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const raw = (body as { url?: unknown })?.url;
  const url = typeof raw === "string" && raw.length <= 500 ? normalizeIcsUrl(raw) : null;
  if (!url) return c.json({ error: "invalid calendar URL" }, 400);
  const feed = await fetchFeed(url);
  if (feed.error) return c.json({ ok: false, error: feed.error });
  await connections.saveCalendar({ url });
  clearCalendarCache();
  return c.json({ ok: true, events: feed.events?.length ?? 0 });
});

api.delete("/calendar/connection", async (c) => {
  await connections.clearCalendar();
  clearCalendarCache();
  return c.json({ ok: true });
});

api.get("/adguard/stats", async (c) => c.json(await getStats()));

api.get("/adguard/connection", async (c) => {
  const connection = await resolveAdguardConnection();
  if (!connection) return c.json({ configured: false });
  return c.json({
    configured: true,
    baseUrl: connection.baseUrl,
    user: connection.user,
  });
});

const adguardConnectionSchema = z.object({
  baseUrl: z.string().min(1).max(200),
  user: z.string().max(100),
  password: z.string().max(200),
});

api.put("/adguard/connection", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const parsed = adguardConnectionSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid connection details" }, 400);

  let lastError: "unauthorized" | "unreachable" | "not-adguard" = "unreachable";
  const candidates = adguardBaseCandidates(parsed.data.baseUrl);
  if (candidates.length === 0) return c.json({ error: "invalid AdGuard URL" }, 400);
  for (const baseUrl of candidates) {
    const candidate = { ...parsed.data, baseUrl };
    const stats = await fetchStats(candidate);
    if (!stats.error) {
      await connections.saveAdguard(candidate);
      clearAdguardCache();
      return c.json({ ok: true, queries: stats.queries ?? 0 });
    }
    if (
      stats.error === "unauthorized" ||
      (stats.error === "not-adguard" && lastError === "unreachable")
    ) {
      lastError = stats.error;
    }
  }
  return c.json({ ok: false, error: lastError });
});

api.delete("/adguard/connection", async (c) => {
  await connections.clearAdguard();
  clearAdguardCache();
  return c.json({ ok: true });
});

api.get("/plex/state", async (c) => c.json(await getPlexState()));

// Artwork proxy: the browser never sees the Plex token, and the transcoder
// resizes server-side so a queue of posters stays small.
api.get("/plex/art", async (c) => {
  const path = c.req.query("path") ?? "";
  if (!isPlexArtPath(path)) return c.json({ error: "invalid art path" }, 400);
  const width = Math.min(1600, Math.max(40, Number(c.req.query("w")) || 480));
  const height = Math.min(1600, Math.max(40, Number(c.req.query("h")) || 270));
  const art = await fetchPlexArt(path, width, height);
  if (!art) return c.json({ error: "artwork unavailable" }, 404);
  return c.body(art.body, 200, {
    "Content-Type": art.contentType,
    "Cache-Control": "public, max-age=3600",
  });
});

api.get("/plex/connection", async (c) => {
  const connection = await resolvePlexConnection();
  if (!connection) return c.json({ configured: false });
  // The token is a credential — report only that one is set.
  return c.json({
    configured: true,
    baseUrl: connection.baseUrl,
    label: connection.label,
  });
});

const plexConnectionSchema = z.object({
  baseUrl: z.string().min(1).max(200),
  token: z.string().min(1).max(200),
  label: z.string().max(40).optional(),
});

api.put("/plex/connection", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const parsed = plexConnectionSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid connection details" }, 400);
  const baseUrl = normalizePlexUrl(parsed.data.baseUrl);
  if (!baseUrl) return c.json({ error: "invalid Plex URL" }, 400);

  const candidate = { ...parsed.data, baseUrl };
  const state = await fetchPlex(candidate);
  if (state.error) return c.json({ ok: false, error: state.error });
  await connections.savePlex(candidate);
  clearPlexCache();
  clearPlexArtCache();
  return c.json({ ok: true, items: state.items?.length ?? 0 });
});

api.delete("/plex/connection", async (c) => {
  await connections.clearPlex();
  clearPlexCache();
  clearPlexArtCache();
  return c.json({ ok: true });
});

/* --- docker hub: namespace required, credentials optional --- */

api.get("/dockerhub/state", async (c) => c.json(await getDockerHubState()));

api.get("/dockerhub/connection", async (c) => {
  const connection = await resolveDockerHubConnection();
  if (!connection) return c.json({ configured: false });
  // The access token is a credential — report only that one is set.
  return c.json({
    configured: true,
    namespace: connection.namespace,
    username: connection.username,
    authenticated: Boolean(connection.username && connection.token),
    label: connection.label,
  });
});

const dockerHubConnectionSchema = z.object({
  namespace: z.string().min(1).max(255),
  username: z.string().max(255).optional(),
  token: z.string().max(500).optional(),
  label: z.string().max(40).optional(),
});

api.put("/dockerhub/connection", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const parsed = dockerHubConnectionSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid connection details" }, 400);
  const namespace = normalizeNamespace(parsed.data.namespace);
  if (!namespace) return c.json({ error: "invalid namespace" }, 400);

  // Credentials are all-or-nothing: half a pair reads as anonymous, which
  // would silently hide the private repositories the user came for.
  const username = parsed.data.username?.trim();
  const token = parsed.data.token?.trim();
  if (Boolean(username) !== Boolean(token)) {
    return c.json({ ok: false, error: "incomplete-credentials" });
  }

  const candidate = {
    namespace,
    ...(username && token ? { username, token } : {}),
    ...(parsed.data.label ? { label: parsed.data.label } : {}),
  };
  clearDockerHubToken();
  const state = await fetchDockerHub(candidate);
  if (state.error) return c.json({ ok: false, error: state.error });
  await connections.saveDockerHub(candidate);
  clearDockerHubCache();
  return c.json({ ok: true, images: state.images?.length ?? 0 });
});

api.delete("/dockerhub/connection", async (c) => {
  await connections.clearDockerHub();
  clearDockerHubCache();
  clearDockerHubToken();
  return c.json({ ok: true });
});

/* --- downloader: one connection per card instance --- */

const instanceIdPattern = /^[A-Za-z0-9_-]{1,64}$/;

api.get("/downloader/:id/stats", async (c) => {
  const id = c.req.param("id");
  if (!instanceIdPattern.test(id)) return c.json({ error: "invalid card id" }, 400);
  return c.json(await getDownloaderStats(id));
});

api.get("/downloader/:id/connection", async (c) => {
  const id = c.req.param("id");
  if (!instanceIdPattern.test(id)) return c.json({ error: "invalid card id" }, 400);
  const connection = await resolveDownloader(id);
  if (!connection) return c.json({ configured: false });
  return c.json({
    configured: true,
    kind: connection.kind,
    baseUrl: connection.baseUrl,
    user: connection.user,
    label: connection.label,
  });
});

const downloaderConnectionSchema = z.object({
  kind: z.enum(["qbittorrent", "transmission"]),
  baseUrl: z.string().min(1).max(200),
  user: z.string().max(100),
  password: z.string().max(200),
  label: z.string().max(40).optional(),
});

api.put("/downloader/:id/connection", async (c) => {
  const id = c.req.param("id");
  if (!instanceIdPattern.test(id)) return c.json({ error: "invalid card id" }, 400);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }
  const parsed = downloaderConnectionSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid connection details" }, 400);
  const baseUrl = normalizeBaseUrl(parsed.data.baseUrl);
  if (!baseUrl) return c.json({ error: "invalid client URL" }, 400);

  const candidate = { ...parsed.data, baseUrl };
  const stats = await fetchDownloader(candidate);
  if (stats.error) return c.json({ ok: false, error: stats.error });
  await connections.saveDownloader(id, candidate);
  clearDownloaderState(id);
  return c.json({ ok: true, transfers: stats.totalCount ?? 0 });
});

api.delete("/downloader/:id/connection", async (c) => {
  const id = c.req.param("id");
  if (!instanceIdPattern.test(id)) return c.json({ error: "invalid card id" }, 400);
  await connections.clearDownloader(id);
  clearDownloaderState(id);
  return c.json({ ok: true });
});

api.get("/ping", async (c) => {
  const raw = c.req.query("url");
  if (!raw) return c.json({ error: "url query parameter required" }, 400);
  let target: URL;
  try {
    target = await assertSafeTarget(raw);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
  return c.json(await probe(target));
});

const app = new Hono();
if (!isProduction) app.use(logger());
app.route("/api", api);

// In production the same process serves the built SPA; in dev, Vite serves the
// frontend and proxies /api here (see vite.config.ts).
if (isProduction) {
  app.use("*", serveStatic({ root: "./dist" }));
  app.use("*", serveStatic({ root: "./dist", path: "index.html" }));
}

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`rackio api listening on http://${info.address}:${info.port}`);
});
