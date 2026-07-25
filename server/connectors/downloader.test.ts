// @vitest-environment node
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clearDownloaderState,
  fetchDownloader,
  mapQbitState,
  mapTransmissionState,
  normalizeBaseUrl,
} from "./downloader.ts";

describe("normalizeBaseUrl", () => {
  it("strips API paths people paste from their browser", () => {
    expect(normalizeBaseUrl("http://nas.lan:8080/api/v2/torrents/info")).toBe(
      "http://nas.lan:8080",
    );
    expect(normalizeBaseUrl("http://nas.lan:9091/transmission/web/")).toBe(
      "http://nas.lan:9091",
    );
    expect(normalizeBaseUrl("http://nas.lan:8080/")).toBe("http://nas.lan:8080");
  });

  it("rejects non-http schemes and garbage", () => {
    expect(normalizeBaseUrl("ftp://nas.lan")).toBeNull();
    expect(normalizeBaseUrl("nope")).toBeNull();
  });
});

describe("state mapping", () => {
  it("maps qBittorrent states", () => {
    expect(mapQbitState("downloading")).toBe("downloading");
    expect(mapQbitState("stalledDL")).toBe("downloading");
    expect(mapQbitState("uploading")).toBe("seeding");
    expect(mapQbitState("stalledUP")).toBe("seeding");
    expect(mapQbitState("queuedDL")).toBe("queued");
    expect(mapQbitState("pausedDL")).toBe("paused");
    expect(mapQbitState("checkingDL")).toBe("checking");
  });

  it("maps Transmission numeric statuses", () => {
    expect(mapTransmissionState(4, 0.5)).toBe("downloading");
    expect(mapTransmissionState(6, 1)).toBe("seeding");
    expect(mapTransmissionState(3, 0)).toBe("queued");
    expect(mapTransmissionState(2, 0.3)).toBe("checking");
    expect(mapTransmissionState(0, 0.4)).toBe("paused");
    expect(mapTransmissionState(0, 1)).toBe("done");
  });
});

/* ---- qBittorrent fake ---- */

describe("fetchDownloader · qBittorrent", () => {
  let loginCalls = 0;
  const server = createServer(async (req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/api/v2/auth/login")) {
      loginCalls += 1;
      const body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
        req.on("end", () => resolve(data));
      });
      if (!body.includes("password=goodpw")) return res.end("Fails.");
      res.setHeader("Set-Cookie", "SID=abc123; HttpOnly; path=/");
      return res.end("Ok.");
    }
    if (req.headers.cookie !== "SID=abc123") {
      res.statusCode = 403;
      return res.end("forbidden");
    }
    res.setHeader("Content-Type", "application/json");
    if (url.startsWith("/api/v2/transfer/info")) {
      return res.end(
        JSON.stringify({ dl_info_speed: 44_800_000, up_info_speed: 2_500_000 }),
      );
    }
    return res.end(
      JSON.stringify([
        {
          hash: "aaa",
          name: "Alpine Linux 3.20 ISO",
          progress: 0.78,
          dlspeed: 6_000_000,
          upspeed: 0,
          eta: 240,
          state: "downloading",
        },
        {
          hash: "bbb",
          name: "Creative Commons Audio",
          progress: 1,
          dlspeed: 0,
          upspeed: 1_100_000,
          eta: 8_640_000,
          state: "uploading",
        },
      ]),
    );
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
  afterAll(() => {
    server.close();
    clearDownloaderState();
  });

  const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  it("logs in, reads throughput and normalizes torrents", async () => {
    const stats = await fetchDownloader({
      kind: "qbittorrent",
      baseUrl: base(),
      user: "kyle",
      password: "goodpw",
    });
    expect(stats.error).toBeUndefined();
    expect(stats.clientName).toBe("qBittorrent");
    expect(stats.downSpeed).toBe(44_800_000);
    expect(stats.transfers?.[0]).toMatchObject({
      name: "Alpine Linux 3.20 ISO",
      progress: 78,
      state: "downloading",
      eta: 240,
    });
    // 8640000 is qBittorrent's "unknown" ETA and must be dropped.
    expect(stats.transfers?.[1].eta).toBeUndefined();
    expect(stats.transfers?.[1].state).toBe("seeding");
    expect(stats.activeCount).toBe(2);
  });

  it("reuses the session cookie across calls", async () => {
    const before = loginCalls;
    await fetchDownloader({
      kind: "qbittorrent",
      baseUrl: base(),
      user: "kyle",
      password: "goodpw",
    });
    expect(loginCalls).toBe(before); // cached login
  });

  it("reports unauthorized when login fails", async () => {
    const stats = await fetchDownloader({
      kind: "qbittorrent",
      baseUrl: `${base()}/x`, // distinct base → no cached cookie
      user: "kyle",
      password: "wrong",
    });
    expect(stats.error).toBe("unauthorized");
  });
});

/* ---- Transmission fake ---- */

describe("fetchDownloader · Transmission", () => {
  let sawCsrfChallenge = false;
  const server = createServer(async (req, res) => {
    if (req.headers["x-transmission-session-id"] !== "session-42") {
      sawCsrfChallenge = true;
      res.statusCode = 409;
      res.setHeader("X-Transmission-Session-Id", "session-42");
      return res.end("Conflict");
    }
    const body = await new Promise<string>((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(data));
    });
    res.setHeader("Content-Type", "application/json");
    if (body.includes("session-stats")) {
      return res.end(
        JSON.stringify({
          arguments: {
            downloadSpeed: 26_500_000,
            uploadSpeed: 3_100_000,
            activeTorrentCount: 2,
            torrentCount: 4,
          },
        }),
      );
    }
    return res.end(
      JSON.stringify({
        arguments: {
          torrents: [
            {
              id: 1,
              name: "Fedora Workstation 40 ISO",
              percentDone: 0.64,
              rateDownload: 18_400_000,
              rateUpload: 0,
              status: 4,
              eta: 420,
            },
            {
              id: 2,
              name: "Debian 13 netinst",
              percentDone: 1,
              rateDownload: 0,
              rateUpload: 2_600_000,
              status: 6,
              eta: -1,
            },
          ],
        },
      }),
    );
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
  afterAll(() => server.close());

  const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  it("completes the CSRF handshake and normalizes torrents", async () => {
    const stats = await fetchDownloader({
      kind: "transmission",
      baseUrl: base(),
      user: "",
      password: "",
    });
    expect(sawCsrfChallenge).toBe(true); // 409 → retry with session id
    expect(stats.error).toBeUndefined();
    expect(stats.clientName).toBe("Transmission");
    expect(stats.downSpeed).toBe(26_500_000);
    expect(stats.totalCount).toBe(4);
    // Sorted by download speed, and a -1 ETA is dropped.
    expect(stats.transfers?.[0].name).toBe("Fedora Workstation 40 ISO");
    expect(stats.transfers?.[1].eta).toBeUndefined();
    expect(stats.transfers?.[1].state).toBe("seeding");
  });

  it("reports unreachable for a dead host", async () => {
    const stats = await fetchDownloader({
      kind: "transmission",
      baseUrl: "http://127.0.0.1:1",
      user: "",
      password: "",
    });
    expect(stats.error).toBe("unreachable");
  });
});
