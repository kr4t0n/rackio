// @vitest-environment node
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adguardAuthHeaders,
  adguardBaseCandidates,
  fetchStats,
  mapStats,
} from "./adguard.ts";

const STATS = {
  time_units: "hours",
  num_dns_queries: 50126,
  num_blocked_filtering: 8421,
  num_replaced_safebrowsing: 40,
  num_replaced_parental: 7,
  avg_processing_time: 0.018,
  top_blocked_domains: [
    { "metrics.example-cdn.test": 1284 },
    { "telemetry.vendor.test": 932 },
  ],
  top_clients: [{ "192.168.1.20": 2941 }, { "192.168.1.31": 2118 }],
  blocked_filtering: Array.from({ length: 30 }, (_, index) => index * 2),
};

describe("mapStats", () => {
  it("derives totals, rate, and the recent series", () => {
    const stats = mapStats(STATS, true);
    expect(stats.queries).toBe(50126);
    expect(stats.blocked).toBe(8421);
    expect(stats.threats).toBe(47); // safebrowsing + parental
    expect(stats.blockRate).toBeCloseTo(16.8, 1);
    expect(stats.protectionEnabled).toBe(true);
    expect(stats.timeUnit).toBe("hours");
    expect(stats.series).toHaveLength(24); // trimmed to the last 24 units
    expect(stats.series?.at(-1)).toBe(58);
  });

  it("converts avg processing time from seconds to milliseconds", () => {
    expect(mapStats(STATS, true).avgProcessingMs).toBe(18);
    // Older builds already report milliseconds.
    expect(mapStats({ ...STATS, avg_processing_time: 24 }, true).avgProcessingMs).toBe(24);
  });

  it("reads both {domain: count} and {name, count} rank shapes", () => {
    const pairs = mapStats(STATS, true).topBlockedDomains;
    expect(pairs?.[0]).toEqual({ name: "metrics.example-cdn.test", count: 1284 });
    const objects = mapStats(
      { ...STATS, top_blocked_domains: [{ name: "ads.test", count: 12 }] },
      true,
    ).topBlockedDomains;
    expect(objects?.[0]).toEqual({ name: "ads.test", count: 12 });
  });

  it("survives an empty instance without dividing by zero", () => {
    const stats = mapStats({ num_dns_queries: 0, num_blocked_filtering: 0 }, false);
    expect(stats.blockRate).toBe(0);
    expect(stats.series).toEqual([]);
  });
});

describe("adguardBaseCandidates", () => {
  it("strips dashboard hashes, query strings, and /control paths", () => {
    expect(adguardBaseCandidates("http://adguard.lan/#/dashboard")).toEqual([
      "http://adguard.lan",
    ]);
    expect(adguardBaseCandidates("http://adguard.lan/control/stats")).toEqual([
      "http://adguard.lan",
    ]);
  });

  it("keeps sub-path mounts with an origin fallback", () => {
    expect(adguardBaseCandidates("https://rack.lan/adguard/")).toEqual([
      "https://rack.lan/adguard",
      "https://rack.lan",
    ]);
  });

  it("rejects non-http schemes and garbage", () => {
    expect(adguardBaseCandidates("ftp://adguard.lan")).toEqual([]);
    expect(adguardBaseCandidates("nope")).toEqual([]);
  });
});

describe("adguardAuthHeaders", () => {
  it("builds basic auth, or nothing when there is no user", () => {
    expect(adguardAuthHeaders({ user: "kyle", password: "pw" })).toEqual({
      Authorization: `Basic ${Buffer.from("kyle:pw").toString("base64")}`,
    });
    expect(adguardAuthHeaders({ user: "", password: "" })).toEqual({});
  });
});

describe("fetchStats", () => {
  const expected = `Basic ${Buffer.from("kyle:pw").toString("base64")}`;
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/html/")) {
      res.setHeader("Content-Type", "text/html");
      return res.end("<!doctype html><html><body>login</body></html>");
    }
    if (req.headers.authorization !== expected) {
      res.statusCode = 401;
      return res.end("forbidden");
    }
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/control/status") {
      return res.end(JSON.stringify({ protection_enabled: true }));
    }
    res.end(JSON.stringify(STATS));
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
  afterAll(() => server.close());

  function base(): string {
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  it("reads stats with valid credentials", async () => {
    const stats = await fetchStats({ baseUrl: base(), user: "kyle", password: "pw" });
    expect(stats.error).toBeUndefined();
    expect(stats.blocked).toBe(8421);
    expect(stats.topClients?.[0].name).toBe("192.168.1.20");
  });

  it("reports unauthorized for bad credentials", async () => {
    const stats = await fetchStats({ baseUrl: base(), user: "kyle", password: "no" });
    expect(stats.error).toBe("unauthorized");
  });

  it("reports not-adguard when the URL answers with something else", async () => {
    const stats = await fetchStats({
      baseUrl: `${base()}/html`,
      user: "",
      password: "",
    });
    expect(stats.error).toBe("not-adguard");
  });

  it("reports unreachable for a dead host", async () => {
    const stats = await fetchStats({
      baseUrl: "http://127.0.0.1:1",
      user: "",
      password: "",
    });
    expect(stats.error).toBe("unreachable");
  });
});
