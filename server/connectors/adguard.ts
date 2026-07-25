import type { AdguardConnection, ConnectionStore } from "../connection-store.ts";

/**
 * AdGuard Home connector. Talks to the instance's REST API (/control/…) with
 * HTTP basic auth. Connection settings come from the card's settings UI and
 * live in connections.json — never in board.json. ADGUARD_* env vars override
 * for deployment-managed setups, mirroring calibre/calendar.
 */

export interface AdguardRank {
  name: string;
  count: number;
}

export interface AdguardStats {
  configured: boolean;
  protectionEnabled?: boolean;
  queries?: number;
  blocked?: number;
  threats?: number;
  blockRate?: number;
  /** Average DNS processing time in milliseconds. */
  avgProcessingMs?: number;
  /** Blocked requests per time unit, oldest → newest. */
  series?: number[];
  timeUnit?: "hours" | "days";
  topBlockedDomains?: AdguardRank[];
  topClients?: AdguardRank[];
  error?: "unauthorized" | "unreachable" | "not-adguard";
}

let connectionStore: ConnectionStore | null = null;

export function initAdguard(store: ConnectionStore): void {
  connectionStore = store;
}

export type AdguardConnectionSource = "env" | "saved";

export async function resolveAdguardConnection(): Promise<
  (AdguardConnection & { source: AdguardConnectionSource }) | null
> {
  const envUrl = process.env.ADGUARD_BASE_URL?.replace(/\/+$/, "");
  if (envUrl) {
    return {
      source: "env",
      baseUrl: envUrl,
      user: process.env.ADGUARD_USER ?? "",
      password: process.env.ADGUARD_PASSWORD ?? "",
    };
  }
  const saved = await connectionStore?.loadAdguard();
  return saved ? { ...saved, source: "saved" } : null;
}

export function adguardAuthHeaders(connection: {
  user: string;
  password: string;
}): Record<string, string> {
  if (!connection.user) return {};
  const token = Buffer.from(`${connection.user}:${connection.password}`).toString(
    "base64",
  );
  return { Authorization: `Basic ${token}` };
}

/**
 * People paste whatever their browser shows. AdGuard's UI lives at the root
 * but deep-links to #/dashboard etc.; strip hash/query and any trailing
 * /control segment, keeping sub-path mounts intact.
 */
export function adguardBaseCandidates(raw: string): string[] {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return [];
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return [];
  const path = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/control(\/.*)?$/, "")
    .replace(/\/+$/, "");
  const candidates = [`${url.origin}${path}`];
  if (path) candidates.push(url.origin);
  return candidates;
}

/** AdGuard reports {"domain": count} pairs; newer builds use {name, count}. */
function toRanks(raw: unknown, limit: number): AdguardRank[] {
  if (!Array.isArray(raw)) return [];
  const ranks: AdguardRank[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.name === "string" && typeof record.count === "number") {
      ranks.push({ name: record.name, count: record.count });
      continue;
    }
    const [name, count] = Object.entries(record)[0] ?? [];
    if (typeof name === "string" && typeof count === "number") {
      ranks.push({ name, count });
    }
  }
  return ranks.slice(0, limit);
}

interface RawStats {
  time_units?: string;
  num_dns_queries?: number;
  num_blocked_filtering?: number;
  num_replaced_safebrowsing?: number;
  num_replaced_parental?: number;
  avg_processing_time?: number;
  top_blocked_domains?: unknown;
  top_clients?: unknown;
  blocked_filtering?: unknown;
}

export function mapStats(
  raw: RawStats,
  protectionEnabled: boolean | undefined,
): AdguardStats {
  const queries = raw.num_dns_queries ?? 0;
  const blocked = raw.num_blocked_filtering ?? 0;
  const threats =
    (raw.num_replaced_safebrowsing ?? 0) + (raw.num_replaced_parental ?? 0);
  // avg_processing_time is seconds in current AdGuard Home builds; older ones
  // reported milliseconds — values below 1 are certainly seconds.
  const avgRaw = raw.avg_processing_time ?? 0;
  const avgProcessingMs = avgRaw < 1 ? avgRaw * 1000 : avgRaw;
  const series = Array.isArray(raw.blocked_filtering)
    ? (raw.blocked_filtering as unknown[])
        .filter((value): value is number => typeof value === "number")
        .slice(-24)
    : [];

  return {
    configured: true,
    protectionEnabled,
    queries,
    blocked,
    threats,
    blockRate: queries > 0 ? (blocked / queries) * 100 : 0,
    avgProcessingMs: Math.round(avgProcessingMs * 10) / 10,
    series,
    timeUnit: raw.time_units === "days" ? "days" : "hours",
    topBlockedDomains: toRanks(raw.top_blocked_domains, 4),
    topClients: toRanks(raw.top_clients, 4),
  };
}

/** Fetch status + stats with the given connection. */
export async function fetchStats(
  connection: AdguardConnection,
): Promise<AdguardStats> {
  const headers = adguardAuthHeaders(connection);
  const signal = () => AbortSignal.timeout(10_000);
  try {
    const [statusResponse, statsResponse] = await Promise.all([
      fetch(`${connection.baseUrl}/control/status`, { headers, signal: signal() }),
      fetch(`${connection.baseUrl}/control/stats`, { headers, signal: signal() }),
    ]);
    if (
      statusResponse.status === 401 ||
      statusResponse.status === 403 ||
      statsResponse.status === 401 ||
      statsResponse.status === 403
    ) {
      return { configured: true, error: "unauthorized" };
    }
    if (!statsResponse.ok) return { configured: true, error: "unreachable" };

    let stats: RawStats;
    let status: { protection_enabled?: boolean } = {};
    try {
      stats = (await statsResponse.json()) as RawStats;
      if (statusResponse.ok) {
        status = (await statusResponse.json()) as { protection_enabled?: boolean };
      }
    } catch {
      return { configured: true, error: "not-adguard" };
    }
    // A login page answers 200 with HTML → JSON parses but has no stats keys.
    if (typeof stats.num_dns_queries !== "number") {
      return { configured: true, error: "not-adguard" };
    }
    return mapStats(stats, status.protection_enabled);
  } catch (error) {
    console.warn("adguard:", (error as Error).message ?? error);
    return { configured: true, error: "unreachable" };
  }
}

interface CacheEntry {
  stats: AdguardStats;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
let cache: { key: string; entry: CacheEntry } | null = null;

export function clearAdguardCache(): void {
  cache = null;
}

export async function getStats(): Promise<AdguardStats> {
  const connection = await resolveAdguardConnection();
  if (!connection) return { configured: false };
  if (cache && cache.key === connection.baseUrl && cache.entry.expiresAt > Date.now()) {
    return cache.entry.stats;
  }
  const stats = await fetchStats(connection);
  cache = {
    key: connection.baseUrl,
    entry: {
      stats,
      expiresAt: Date.now() + (stats.error ? 20_000 : CACHE_TTL_MS),
    },
  };
  return stats;
}
