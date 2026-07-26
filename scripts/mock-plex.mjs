/**
 * Fake Plex Media Server for developing the plex card without a real one.
 * Serves /, /library/onDeck and the photo transcoder (generated SVG art).
 *
 *   node scripts/mock-plex.mjs            # http://localhost:8099, token "demo"
 */
import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 8099);
const token = process.env.MOCK_TOKEN ?? "demo";

/** ONDECK=1 mimics the common real-world case: one thing in progress. */
const onDeckCount = Number(process.env.ONDECK ?? 4);

const ITEMS = [
  { ratingKey: "1201", key: "/library/metadata/1201", type: "episode",
    title: "Signal Tide", grandparentTitle: "Signal Tide", parentIndex: 1, index: 4,
    viewOffset: 1_680_000, duration: 2_700_000, hue: 220,
    art: "/library/metadata/1200/art/1", thumb: "/library/metadata/1201/thumb/1" },
  { ratingKey: "1310", key: "/library/metadata/1310", type: "episode",
    title: "Nightline", grandparentTitle: "Nightline", parentIndex: 2, index: 1,
    viewOffset: 900_000, duration: 3_400_000, hue: 20,
    art: "/library/metadata/1309/art/1", thumb: "/library/metadata/1310/thumb/1" },
  { ratingKey: "77", key: "/library/metadata/77", type: "movie",
    title: "North House", year: 2024,
    viewOffset: 3_900_000, duration: 5_400_000, hue: 150,
    art: "/library/metadata/77/art/1", thumb: "/library/metadata/77/thumb/1" },
  { ratingKey: "88", key: "/library/metadata/88", type: "movie",
    title: "Below the Shelf", year: 2023,
    viewOffset: 800_000, duration: 6_000_000, hue: 300,
    art: "/library/metadata/88/art/1", thumb: "/library/metadata/88/thumb/1" },
];

/** Recently added — no view offset, mixed types, plus one album to be filtered. */
const RECENT = [
  { ratingKey: "2401", key: "/library/metadata/2401", type: "movie",
    title: "Harbour Lights", year: 2025, duration: 6_720_000, hue: 265,
    art: "/library/metadata/2401/art/1", thumb: "/library/metadata/2401/thumb/1" },
  { ratingKey: "2402", key: "/library/metadata/2402", type: "season",
    title: "Season 3", parentTitle: "Coastline", index: 3, leafCount: 8, hue: 95,
    art: "/library/metadata/2400/art/1", thumb: "/library/metadata/2402/thumb/1" },
  { ratingKey: "2403", key: "/library/metadata/2403", type: "episode",
    title: "Deep Field", grandparentTitle: "Orbital", parentIndex: 1, index: 2,
    duration: 2_940_000, hue: 340,
    art: "/library/metadata/2399/art/1", thumb: "/library/metadata/2403/thumb/1" },
  { ratingKey: "2404", key: "/library/metadata/2404", type: "album",
    title: "Not a video", hue: 40, thumb: "/library/metadata/2404/thumb/1" },
];

/** Deterministic art so screenshots are stable: gradient + title band. */
function artSvg(item, width, height) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${item.hue} 55% 38%)"/>
    <stop offset="1" stop-color="hsl(${(item.hue + 40) % 360} 60% 12%)"/>
  </linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
  <circle cx="${width * 0.72}" cy="${height * 0.3}" r="${height * 0.22}" fill="hsl(${item.hue} 70% 70% / 0.25)"/>
  <circle cx="${width * 0.24}" cy="${height * 0.78}" r="${height * 0.3}" fill="hsl(${(item.hue + 60) % 360} 60% 45% / 0.18)"/>
</svg>`;
}

function findByArtPath(path) {
  const all = [...ITEMS, ...RECENT];
  return all.find((item) => item.art === path || item.thumb === path) ?? all[0];
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://mock");
  const supplied =
    req.headers["x-plex-token"] ?? url.searchParams.get("X-Plex-Token");
  if (supplied !== token) {
    res.statusCode = 401;
    return res.end("Unauthorized");
  }

  if (url.pathname === "/photo/:/transcode") {
    const item = findByArtPath(url.searchParams.get("url") ?? "");
    const width = Number(url.searchParams.get("width")) || 480;
    const height = Number(url.searchParams.get("height")) || 270;
    res.setHeader("Content-Type", "image/svg+xml");
    return res.end(artSvg(item, width, height));
  }

  res.setHeader("Content-Type", "application/json");
  if (url.pathname === "/") {
    return res.end(
      JSON.stringify({
        MediaContainer: {
          friendlyName: "Rackio Media",
          machineIdentifier: "mock-machine-id",
          version: "1.40.mock",
        },
      }),
    );
  }
  if (url.pathname === "/library/onDeck") {
    const deck = ITEMS.slice(0, onDeckCount);
    return res.end(
      JSON.stringify({ MediaContainer: { size: deck.length, Metadata: deck } }),
    );
  }
  if (url.pathname === "/library/recentlyAdded") {
    return res.end(
      JSON.stringify({ MediaContainer: { size: RECENT.length, Metadata: RECENT } }),
    );
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
}).listen(port, () => {
  console.log(`mock plex on http://localhost:${port} (token: ${token})`);
});
