/**
 * Fake torrent clients for developing the downloader card:
 *   node scripts/mock-downloader.mjs        # qBittorrent on :8097
 *   KIND=transmission PORT=8098 node scripts/mock-downloader.mjs
 *
 * MOCK_USER / MOCK_PASSWORD enable auth (qBittorrent login, Transmission basic).
 * Speeds drift a little on each poll so the throughput chart has movement.
 */
import { createServer } from "node:http";

const kind = process.env.KIND === "transmission" ? "transmission" : "qbittorrent";
const port = Number(process.env.PORT ?? (kind === "transmission" ? 8098 : 8097));
const user = process.env.MOCK_USER;
const password = process.env.MOCK_PASSWORD;

let tick = 0;
const drift = () => 0.75 + 0.5 * Math.abs(Math.sin(tick / 3));

const QBIT_TORRENTS = [
  { hash: "a1", name: "Alpine Linux 3.20 ISO", progress: 0.78, dlspeed: 6_100_000, upspeed: 0, eta: 240, state: "downloading" },
  { hash: "a2", name: "Open Movie Archive", progress: 0.41, dlspeed: 11_700_000, upspeed: 0, eta: 1320, state: "downloading" },
  { hash: "a3", name: "Public Dataset · July", progress: 0.92, dlspeed: 27_000_000, upspeed: 0, eta: 120, state: "downloading" },
  { hash: "a4", name: "Creative Commons Audio", progress: 1, dlspeed: 0, upspeed: 1_150_000, eta: 8_640_000, state: "uploading" },
  { hash: "a5", name: "Public Domain Film Pack", progress: 0, dlspeed: 0, upspeed: 0, eta: 8_640_000, state: "queuedDL" },
];

const TRANSMISSION_TORRENTS = [
  { id: 1, name: "Fedora Workstation 40 ISO", percentDone: 0.64, rateDownload: 19_300_000, rateUpload: 0, status: 4, eta: 420 },
  { id: 2, name: "Blender Open Movie Assets", percentDone: 0.37, rateDownload: 8_500_000, rateUpload: 0, status: 4, eta: 1860 },
  { id: 3, name: "Debian 13 netinst", percentDone: 1, rateDownload: 0, rateUpload: 2_700_000, status: 6, eta: -1 },
  { id: 4, name: "Public Domain Film Pack", percentDone: 0, rateDownload: 0, rateUpload: 0, status: 3, eta: -1 },
];

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

createServer(async (req, res) => {
  tick += 1;
  const url = req.url ?? "";

  if (kind === "qbittorrent") {
    if (url.startsWith("/api/v2/auth/login")) {
      const body = await readBody(req);
      if (user && !body.includes(`password=${encodeURIComponent(password ?? "")}`)) {
        return res.end("Fails.");
      }
      res.setHeader("Set-Cookie", "SID=mock-session; path=/");
      return res.end("Ok.");
    }
    if (user && req.headers.cookie !== "SID=mock-session") {
      res.statusCode = 403;
      return res.end("forbidden");
    }
    res.setHeader("Content-Type", "application/json");
    if (url.startsWith("/api/v2/transfer/info")) {
      return res.end(
        JSON.stringify({
          dl_info_speed: Math.round(44_800_000 * drift()),
          up_info_speed: Math.round(2_500_000 * drift()),
        }),
      );
    }
    if (url.startsWith("/api/v2/torrents/info")) {
      return res.end(
        JSON.stringify(
          QBIT_TORRENTS.map((torrent) => ({
            ...torrent,
            dlspeed: Math.round(torrent.dlspeed * drift()),
          })),
        ),
      );
    }
    res.statusCode = 404;
    return res.end("{}");
  }

  // Transmission RPC with the CSRF handshake.
  if (req.headers["x-transmission-session-id"] !== "mock-session-id") {
    res.statusCode = 409;
    res.setHeader("X-Transmission-Session-Id", "mock-session-id");
    return res.end("Conflict");
  }
  if (user) {
    const expected = `Basic ${Buffer.from(`${user}:${password ?? ""}`).toString("base64")}`;
    if (req.headers.authorization !== expected) {
      res.statusCode = 401;
      return res.end("Unauthorized");
    }
  }
  const body = await readBody(req);
  res.setHeader("Content-Type", "application/json");
  if (body.includes("session-stats")) {
    return res.end(
      JSON.stringify({
        arguments: {
          downloadSpeed: Math.round(26_500_000 * drift()),
          uploadSpeed: Math.round(3_100_000 * drift()),
          activeTorrentCount: 3,
          torrentCount: TRANSMISSION_TORRENTS.length,
        },
      }),
    );
  }
  res.end(
    JSON.stringify({
      arguments: {
        torrents: TRANSMISSION_TORRENTS.map((torrent) => ({
          ...torrent,
          rateDownload: Math.round(torrent.rateDownload * drift()),
        })),
      },
    }),
  );
}).listen(port, () => {
  console.log(`mock ${kind} on http://localhost:${port}`);
});
