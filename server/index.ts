import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { z } from "zod";
import { validateBoardState } from "../shared/board-schema.ts";
import { createConnectionStore } from "./connection-store.ts";
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

// Load .env if present (secrets like CALIBRE_* live there, never in git).
try {
  process.loadEnvFile();
} catch {
  // No .env file — environment comes from the process (Docker/k8s).
}

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 8787);
// Bind all interfaces — rackio is reached over the LAN/tailnet, not just localhost.
const hostname = process.env.HOST ?? "0.0.0.0";

const dataDir = process.env.DATA_DIR ?? "data";
const store = createBoardStore(dataDir);
const connections = createConnectionStore(dataDir);
initCalibre(connections, dataDir);

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
    source: connection.source,
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
  const current = await resolveConnection();
  if (current?.source === "env") {
    return c.json({ error: "connection is managed by the server environment" }, 409);
  }
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
  const current = await resolveConnection();
  if (current?.source === "env") {
    return c.json({ error: "connection is managed by the server environment" }, 409);
  }
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
