// @vitest-environment node
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeItem, fetchPlex, isPlexArtPath, mapItems, normalizePlexUrl } from "./plex.ts";

const EPISODE = {
  ratingKey: "1201",
  key: "/library/metadata/1201",
  type: "episode",
  title: "Signal Tide",
  grandparentTitle: "Signal",
  parentIndex: 1,
  index: 4,
  viewOffset: 1_680_000, // 28 min in
  duration: 2_700_000, // 45 min
  art: "/library/metadata/1200/art/1",
  thumb: "/library/metadata/1201/thumb/1",
};

const MOVIE = {
  ratingKey: "77",
  key: "/library/metadata/77",
  type: "movie",
  title: "North House",
  year: 2024,
  viewOffset: 600_000,
  duration: 5_400_000,
  thumb: "/library/metadata/77/thumb/1",
};

describe("normalizePlexUrl", () => {
  it("strips the web app path people paste from the browser", () => {
    expect(normalizePlexUrl("http://nas.lan:32400/web/index.html#!/whatever")).toBe(
      "http://nas.lan:32400",
    );
    expect(normalizePlexUrl("http://nas.lan:32400/")).toBe("http://nas.lan:32400");
  });

  it("rejects non-http schemes and garbage", () => {
    expect(normalizePlexUrl("ftp://nas.lan")).toBeNull();
    expect(normalizePlexUrl("nope")).toBeNull();
  });
});

describe("describeItem", () => {
  it("labels episodes by season/episode and remaining time", () => {
    expect(describeItem(EPISODE)).toBe("S1 E4 · 17 min left");
  });

  it("labels films by year", () => {
    expect(describeItem(MOVIE)).toBe("2024 · 80 min left");
  });

  it("survives an item with no duration", () => {
    expect(describeItem({ type: "episode", parentIndex: 2, index: 9 })).toBe(
      "S2 E9 · Up next",
    );
  });
});

describe("mapItems", () => {
  const items = mapItems([EPISODE, MOVIE], "http://plex.lan:32400", "abc123");

  it("computes progress and keeps the show title for episodes", () => {
    expect(items[0]).toMatchObject({
      id: "1201",
      title: "Signal Tide",
      showTitle: "Signal",
      progress: 62,
    });
    expect(items[1].showTitle).toBeUndefined();
  });

  it("prefers landscape art for the hero and poster art for tiles", () => {
    expect(items[0].artPath).toBe("/library/metadata/1200/art/1");
    expect(items[0].posterPath).toBe("/library/metadata/1201/thumb/1");
    // A movie with no art falls back to its poster.
    expect(items[1].artPath).toBe("/library/metadata/77/thumb/1");
  });

  it("builds a deep link into the Plex web app", () => {
    expect(items[0].webUrl).toBe(
      "http://plex.lan:32400/web/index.html#!/server/abc123/details?key=%2Flibrary%2Fmetadata%2F1201",
    );
  });

  it("omits the link when the server identity is unknown", () => {
    expect(mapItems([EPISODE], "http://plex.lan", undefined)[0].webUrl).toBeUndefined();
  });
});

describe("isPlexArtPath", () => {
  it("allows Plex media paths only", () => {
    expect(isPlexArtPath("/library/metadata/1/thumb/2")).toBe(true);
    expect(isPlexArtPath("/photo/:/transcode")).toBe(true);
    expect(isPlexArtPath("http://evil.test/x.png")).toBe(false);
    expect(isPlexArtPath("/etc/passwd")).toBe(false);
  });
});

describe("fetchPlex", () => {
  const server = createServer((req, res) => {
    if (req.headers["x-plex-token"] !== "good-token") {
      res.statusCode = 401;
      return res.end("Unauthorized");
    }
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/") {
      return res.end(
        JSON.stringify({
          MediaContainer: { friendlyName: "Rackio Media", machineIdentifier: "abc123" },
        }),
      );
    }
    if (req.url?.startsWith("/library/onDeck")) {
      return res.end(JSON.stringify({ MediaContainer: { Metadata: [EPISODE, MOVIE] } }));
    }
    res.statusCode = 404;
    res.end("{}");
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
  afterAll(() => server.close());

  const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  it("reads the server name and on-deck queue", async () => {
    const state = await fetchPlex({ baseUrl: base(), token: "good-token" });
    expect(state.error).toBeUndefined();
    expect(state.serverName).toBe("Rackio Media");
    expect(state.items?.[0].title).toBe("Signal Tide");
  });

  it("prefers an explicit card label over the server's own name", async () => {
    const state = await fetchPlex({
      baseUrl: base(),
      token: "good-token",
      label: "Movie box",
    });
    expect(state.serverName).toBe("Movie box");
  });

  it("reports a rejected token", async () => {
    const state = await fetchPlex({ baseUrl: base(), token: "nope" });
    expect(state.error).toBe("unauthorized");
  });

  it("reports an unreachable server", async () => {
    const state = await fetchPlex({ baseUrl: "http://127.0.0.1:1", token: "x" });
    expect(state.error).toBe("unreachable");
  });
});
