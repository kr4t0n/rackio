/**
 * Minimal AdGuard Home API mock for developing the adguard card without a
 * real instance. Serves /control/status and /control/stats, with optional
 * basic auth (MOCK_USER/MOCK_PASSWORD).
 *
 *   node scripts/mock-adguard.mjs      # http://localhost:8095
 */
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8095);
const user = process.env.MOCK_USER;
const password = process.env.MOCK_PASSWORD;

const hourly = [
  18, 15, 13, 12, 14, 19, 28, 37, 44, 39, 42, 48, 53, 49, 57, 61, 58, 66, 72, 69,
  63, 55, 46, 38,
];

const stats = {
  time_units: "hours",
  num_dns_queries: 50126,
  num_blocked_filtering: 8421,
  num_replaced_safebrowsing: 40,
  num_replaced_parental: 7,
  avg_processing_time: 0.018,
  top_blocked_domains: [
    { "metrics.example-cdn.test": 1284 },
    { "telemetry.vendor.test": 932 },
    { "ads.media-network.test": 706 },
    { "track.example.test": 488 },
  ],
  top_clients: [
    { "Living room": 2941 },
    { Laptop: 2118 },
    { Phone: 1804 },
    { "Rack services": 1558 },
  ],
  blocked_filtering: hourly,
};

createServer((req, res) => {
  if (user) {
    const expected = `Basic ${Buffer.from(`${user}:${password ?? ""}`).toString("base64")}`;
    if (req.headers.authorization !== expected) {
      res.statusCode = 401;
      return res.end("forbidden");
    }
  }
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/control/status") {
    return res.end(JSON.stringify({ protection_enabled: true, version: "v0.107.mock" }));
  }
  if (req.url === "/control/stats") {
    return res.end(JSON.stringify(stats));
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
}).listen(port, () => {
  console.log(`mock adguard on http://localhost:${port}`);
});
