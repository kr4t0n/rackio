import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { validateBoardState } from "../shared/board-schema.ts";
import { fetchCover, getShelf } from "./connectors/calibre.ts";
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

const store = createBoardStore(process.env.DATA_DIR ?? "data");

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
