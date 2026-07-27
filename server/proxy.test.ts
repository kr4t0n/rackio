// @vitest-environment node
import { createServer } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { isBypassed, proxyDispatcherFor, resetProxyAgents, withProxy } from "./proxy.ts";
import { fetchDockerHub } from "./connectors/dockerhub.ts";

const PROXY_VARS = [
  "http_proxy",
  "HTTP_PROXY",
  "https_proxy",
  "HTTPS_PROXY",
  "all_proxy",
  "ALL_PROXY",
  "no_proxy",
  "NO_PROXY",
];

function clearProxyEnv() {
  for (const name of PROXY_VARS) delete process.env[name];
  resetProxyAgents();
}

afterEach(clearProxyEnv);

describe("isBypassed", () => {
  it("matches a host, its subdomains, and a leading dot", () => {
    expect(isBypassed("hub.docker.com", "443", "hub.docker.com")).toBe(true);
    expect(isBypassed("hub.docker.com", "443", ".docker.com")).toBe(true);
    expect(isBypassed("hub.docker.com", "443", "docker.com")).toBe(true);
    expect(isBypassed("notdocker.com", "443", "docker.com")).toBe(false);
  });

  it("honours * and respects a port when one is given", () => {
    expect(isBypassed("anything.test", "443", "*")).toBe(true);
    expect(isBypassed("nas.lan", "8080", "nas.lan:8080")).toBe(true);
    expect(isBypassed("nas.lan", "9091", "nas.lan:8080")).toBe(false);
  });

  it("takes a comma or whitespace separated list", () => {
    expect(isBypassed("nas.lan", "", "localhost, .lan , 10.0.0.1")).toBe(true);
  });
});

describe("proxyDispatcherFor", () => {
  it("goes direct when nothing is configured", () => {
    expect(proxyDispatcherFor("https://hub.docker.com/v2/")).toBeUndefined();
  });

  it("picks the variable matching the target's scheme", () => {
    process.env.HTTPS_PROXY = "http://proxy.lan:3128";
    expect(proxyDispatcherFor("https://hub.docker.com/v2/")).toBeDefined();
    // No http_proxy set, so a plain-http target stays direct.
    expect(proxyDispatcherFor("http://hub.docker.com/v2/")).toBeUndefined();
  });

  it("prefers the lowercase spelling, as curl does", () => {
    process.env.https_proxy = "http://lower.lan:3128";
    process.env.HTTPS_PROXY = "http://upper.lan:3128";
    // Same agent instance is reused per proxy URL, so identity proves which won.
    const first = proxyDispatcherFor("https://hub.docker.com/v2/");
    process.env.https_proxy = "http://upper.lan:3128";
    resetProxyAgents();
    const second = proxyDispatcherFor("https://hub.docker.com/v2/");
    expect(first).not.toBe(second);
  });

  it("falls back to ALL_PROXY", () => {
    process.env.ALL_PROXY = "http://proxy.lan:3128";
    expect(proxyDispatcherFor("https://hub.docker.com/v2/")).toBeDefined();
  });

  it("respects NO_PROXY", () => {
    process.env.HTTPS_PROXY = "http://proxy.lan:3128";
    process.env.NO_PROXY = "docker.com";
    expect(proxyDispatcherFor("https://hub.docker.com/v2/")).toBeUndefined();
  });

  it("reuses one agent per proxy so sockets don't leak", () => {
    process.env.HTTPS_PROXY = "http://proxy.lan:3128";
    expect(proxyDispatcherFor("https://hub.docker.com/a")).toBe(
      proxyDispatcherFor("https://hub.docker.com/b"),
    );
  });

  it("ignores a target that isn't a URL", () => {
    process.env.HTTPS_PROXY = "http://proxy.lan:3128";
    expect(proxyDispatcherFor("not a url")).toBeUndefined();
  });

  it("leaves init untouched when going direct", () => {
    const init = { headers: { a: "b" } };
    expect(withProxy("https://hub.docker.com/v2/", init)).toBe(init);
  });
});

/**
 * End-to-end through a real proxy — the part worth proving is that undici's
 * ProxyAgent is accepted as a `dispatcher` by Node's *built-in* fetch, since
 * the two are separate copies of undici.
 */
describe("fetchDockerHub through a proxy", () => {
  const proxied: string[] = [];

  // The Hub stand-in.
  const origin = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url?.startsWith("/v2/repositories/acme/") && req.url.includes("/tags/")) {
      return res.end(
        JSON.stringify({
          results: [{ name: "1.0.0", last_updated: "2026-07-01T00:00:00Z" }],
        }),
      );
    }
    if (req.url?.startsWith("/v2/repositories/acme/")) {
      return res.end(
        JSON.stringify({
          results: [{ name: "app", last_updated: "2026-07-01T00:00:00Z" }],
        }),
      );
    }
    res.statusCode = 404;
    res.end("{}");
  });

  // A real proxy: undici's ProxyAgent tunnels with CONNECT rather than
  // forwarding absolute URIs, so this has to speak both.
  const proxy = createServer((req, res) => {
    proxied.push(`FORWARD ${req.url}`);
    res.statusCode = 502;
    res.end("{}");
  });
  proxy.on("connect", (req, clientSocket, head) => {
    proxied.push(`CONNECT ${req.url}`);
    const [host, port] = (req.url ?? "").split(":");
    const upstream = connect(Number(port), host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });

  beforeAll(async () => {
    await new Promise<void>((r) => origin.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  });
  afterAll(() => {
    origin.close();
    proxy.close();
  });

  const originUrl = () => `http://127.0.0.1:${(origin.address() as AddressInfo).port}`;
  const proxyUrl = () => `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

  it("routes Docker Hub requests through the proxy when one is set", async () => {
    process.env.HTTP_PROXY = proxyUrl();
    proxied.length = 0;

    const state = await fetchDockerHub({ namespace: "acme" }, originUrl());

    expect(state.error).toBeUndefined();
    expect(state.images?.[0].name).toBe("acme/app");
    // Every request reached the origin through the proxy's tunnel.
    expect(proxied.length).toBeGreaterThan(0);
    expect(proxied.every((entry) => entry.startsWith("CONNECT"))).toBe(true);
  });

  it("goes direct when NO_PROXY covers the host", async () => {
    process.env.HTTP_PROXY = proxyUrl();
    process.env.NO_PROXY = "127.0.0.1";
    proxied.length = 0;

    const state = await fetchDockerHub({ namespace: "acme" }, originUrl());

    expect(state.images?.[0].name).toBe("acme/app");
    expect(proxied).toEqual([]);
  });
});
