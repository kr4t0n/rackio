import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { validateBoardState } from "../shared/board-schema.ts";
import { assertSafeTarget, probe } from "./connectors/ping.ts";
import { createBoardStore } from "./store.ts";

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
