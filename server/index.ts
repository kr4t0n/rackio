import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { logger } from "hono/logger";

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 8787);
// Bind all interfaces — rackio is reached over the LAN/tailnet, not just localhost.
const hostname = process.env.HOST ?? "0.0.0.0";

const api = new Hono();

api.get("/health", (c) =>
  c.json({ status: "ok", service: "rackio", uptime: process.uptime() }),
);

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
