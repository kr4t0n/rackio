// @vitest-environment node
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { assertSafeTarget, isPrivateAddress, probe } from "./ping.ts";

describe("isPrivateAddress", () => {
  it("accepts loopback, RFC1918, link-local, and CGNAT ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.10",
      "169.254.0.5",
      "100.64.0.1",
      "100.90.0.0", // tailnet
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:192.168.1.1",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("rejects public addresses and non-IPs", () => {
    for (const ip of [
      "8.8.8.8",
      "1.1.1.1",
      "172.32.0.1",
      "100.128.0.1",
      "2606:4700::1111",
      "::ffff:8.8.8.8",
      "not-an-ip",
      "",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe("assertSafeTarget", () => {
  it("accepts private http(s) targets", async () => {
    await expect(
      assertSafeTarget("http://192.168.1.20:8083/health"),
    ).resolves.toBeInstanceOf(URL);
    await expect(assertSafeTarget("http://localhost:8787")).resolves.toBeInstanceOf(
      URL,
    );
  });

  it("rejects public IPs, bad schemes, and garbage", async () => {
    await expect(assertSafeTarget("http://8.8.8.8")).rejects.toThrow(
      /local network/,
    );
    await expect(assertSafeTarget("ftp://192.168.1.1")).rejects.toThrow(
      /http\(s\)/,
    );
    await expect(assertSafeTarget("not a url")).rejects.toThrow(/invalid URL/);
  });
});

describe("probe", () => {
  const server = createServer((req, res) => {
    if (req.url === "/slow") return; // never respond → timeout
    res.statusCode = req.url === "/broken" ? 500 : 200;
    res.end("ok");
  });
  afterAll(() => server.close());

  it("reports a responding service as up with latency", async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const result = await probe(new URL(`http://127.0.0.1:${port}/`));
    expect(result.up).toBe(true);
    expect(result.status).toBe(200);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports 5xx as down (service responding but unhealthy)", async () => {
    const { port } = server.address() as AddressInfo;
    const result = await probe(new URL(`http://127.0.0.1:${port}/broken`));
    expect(result.up).toBe(false);
    expect(result.status).toBe(500);
  });

  it("reports an unreachable service as down", async () => {
    const result = await probe(new URL("http://127.0.0.1:1/"), 500);
    expect(result.up).toBe(false);
    expect(result.status).toBeUndefined();
  });

  it("times out slow services", async () => {
    const { port } = server.address() as AddressInfo;
    const result = await probe(new URL(`http://127.0.0.1:${port}/slow`), 300);
    expect(result.up).toBe(false);
  });
});
