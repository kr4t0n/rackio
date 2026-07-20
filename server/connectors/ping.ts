import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Health probe for rack services. Rackio's job is watching *local* services,
 * so the probe refuses anything that doesn't resolve to a private address —
 * which also keeps /api/ping from being an open SSRF proxy.
 */

export interface PingResult {
  up: boolean;
  status?: number;
  latencyMs?: number;
}

/** Loopback, RFC1918, link-local, CGNAT (Tailscale), and private IPv6. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127) // 100.64.0.0/10 — tailnet lives here
    );
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::1") return true;
    if (lower.startsWith("fe8") || lower.startsWith("fc") || lower.startsWith("fd")) {
      return true;
    }
    // IPv4-mapped (::ffff:10.0.0.1)
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return false;
}

/**
 * Parse and vet a ping target. Returns the URL if it is http(s) and resolves
 * to a private address; otherwise throws with a human-readable reason.
 */
export async function assertSafeTarget(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("only http(s) targets are supported");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let address = host;
  if (!isIP(host)) {
    try {
      ({ address } = await lookup(host));
    } catch {
      throw new Error(`cannot resolve host ${host}`);
    }
  }
  if (!isPrivateAddress(address)) {
    throw new Error("target must be on the local network");
  }
  return url;
}

/** Probe a vetted URL. Any HTTP response below 500 counts as up. */
export async function probe(url: URL, timeoutMs = 4000): Promise<PingResult> {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    return { up: response.status < 500, status: response.status, latencyMs };
  } catch {
    return { up: false };
  }
}
