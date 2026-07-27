import { ProxyAgent } from "undici";

/**
 * Outbound HTTP proxy support for the connectors that leave the rack.
 *
 * Node 22 ignores `HTTPS_PROXY` entirely (built-in support only arrives in
 * Node 24 behind `NODE_USE_ENV_PROXY`), so a pod in a cluster with no direct
 * egress cannot reach Docker Hub however the environment is configured. This
 * reads the conventional variables and hands back a dispatcher for the
 * requests that should go through the proxy.
 *
 * Deliberately opt-in per call rather than a global dispatcher: rack
 * services (Calibre, AdGuard, Plex, torrent clients) are on the LAN and must
 * keep going direct — routing them through an internet proxy would break
 * every card that works today.
 */

/** Lowercase wins, as curl and most tooling do it. */
function envProxy(protocol: string): string | undefined {
  const names =
    protocol === "https:"
      ? ["https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"]
      : ["http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY"];
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * NO_PROXY semantics: `*` disables proxying outright, otherwise a
 * comma-separated list of hosts. An entry matches the host itself or any
 * subdomain of it, with or without a leading dot, and may carry a port.
 */
export function isBypassed(hostname: string, port: string, noProxy: string): boolean {
  const entries = noProxy
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (entries.includes("*")) return true;

  const host = hostname.toLowerCase();
  return entries.some((entry) => {
    const [pattern, entryPort] = entry.startsWith("[")
      ? [entry, ""] // bracketed IPv6 literal — no port split
      : entry.split(":");
    if (entryPort && entryPort !== port) return false;
    const bare = pattern.replace(/^\./, "");
    return host === bare || host.endsWith(`.${bare}`);
  });
}

/**
 * Node's `RequestInit` already declares `dispatcher`, but its type comes from
 * the copy of undici's types bundled with @types/node, which disagrees
 * structurally with the `undici` package's own. Both describe the same
 * runtime object — Node's fetch *is* undici — so bridging the two copies is
 * the one place a cast is warranted.
 */
type NodeDispatcher = NonNullable<RequestInit["dispatcher"]>;

// One agent per proxy URL: a fresh ProxyAgent per request would leak sockets.
const agents = new Map<string, ProxyAgent>();

export function resetProxyAgents(): void {
  for (const agent of agents.values()) void agent.close();
  agents.clear();
}

/**
 * The dispatcher to use for `target`, or undefined to go direct. Pass the
 * result straight to fetch's `dispatcher` option.
 */
export function proxyDispatcherFor(target: string): NodeDispatcher | undefined {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return undefined;
  }
  const proxy = envProxy(url.protocol);
  if (!proxy) return undefined;

  const noProxy = process.env.no_proxy ?? process.env.NO_PROXY ?? "";
  if (noProxy && isBypassed(url.hostname, url.port, noProxy)) return undefined;

  let agent = agents.get(proxy);
  if (!agent) {
    agent = new ProxyAgent(proxy);
    agents.set(proxy, agent);
  }
  return agent as unknown as NodeDispatcher;
}

/** `fetch(url, withProxy(url, init))` — direct unless the env says otherwise. */
export function withProxy(target: string, init: RequestInit = {}): RequestInit {
  const dispatcher = proxyDispatcherFor(target);
  return dispatcher ? { ...init, dispatcher } : init;
}
