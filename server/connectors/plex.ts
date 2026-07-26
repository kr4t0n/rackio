import type { ConnectionStore, PlexConnection } from "../connection-store.ts";

/**
 * Plex Media Server connector. Reads the "on deck" / continue-watching hub
 * over Plex's HTTP API, which authenticates with an `X-Plex-Token` rather
 * than a username/password. The token lives in connections.json (never in
 * board.json) and artwork is proxied so the browser never sees it.
 */

/** Where an item came from — on-deck resumes, recently-added fills the rest. */
export type PlexItemKind = "watching" | "recent";

export interface PlexItem {
  id: string;
  kind: PlexItemKind;
  /** Episode title, or the movie title. */
  title: string;
  /** Show name for episodes; empty for movies. */
  showTitle?: string;
  /** "S1 E4 · 28 min left" style line, assembled server-side. */
  detail: string;
  /** 0–100; always 0 for recently-added items. */
  progress: number;
  /** Path for /api/plex/art, already resolved to the best available image. */
  artPath?: string;
  posterPath?: string;
  /** Deep link into the Plex web app. */
  webUrl?: string;
}

export interface PlexState {
  configured: boolean;
  serverName?: string;
  /** Continue-watching, newest resume first. Often just one entry. */
  items?: PlexItem[];
  /** Recently added, already deduped against `items` — fills the queue rail. */
  recent?: PlexItem[];
  error?: "unauthorized" | "unreachable" | "not-plex";
}

let connectionStore: ConnectionStore | null = null;

export function initPlex(store: ConnectionStore): void {
  connectionStore = store;
}

export async function resolvePlexConnection(): Promise<PlexConnection | null> {
  return (await connectionStore?.loadPlex()) ?? null;
}

/** People paste the web app URL; strip the SPA path back to the server root. */
export function normalizePlexUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const path = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/web(\/.*)?$/, "")
    .replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

function plexHeaders(connection: PlexConnection): Record<string, string> {
  return {
    Accept: "application/json",
    "X-Plex-Token": connection.token,
    // Plex logs these; identifying ourselves is polite and aids debugging.
    "X-Plex-Product": "rackio",
    "X-Plex-Client-Identifier": "rackio-dashboard",
  };
}

interface PlexMetadata {
  ratingKey?: string;
  key?: string;
  type?: string;
  title?: string;
  parentTitle?: string;
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
  year?: number;
  viewOffset?: number;
  duration?: number;
  /** Episodes in a season/show, on recently-added entries. */
  leafCount?: number;
  art?: string;
  thumb?: string;
  grandparentArt?: string;
  grandparentThumb?: string;
  parentThumb?: string;
}

function minutesLeft(item: PlexMetadata): number | null {
  if (!item.duration) return null;
  const remaining = item.duration - (item.viewOffset ?? 0);
  if (remaining <= 0) return null;
  return Math.max(1, Math.round(remaining / 60_000));
}

/** "S1 E4 · 28 min left" for episodes, "2024 · 28 min left" for films. */
export function describeItem(item: PlexMetadata): string {
  const parts: string[] = [];
  if (item.type === "episode" && item.parentIndex && item.index) {
    parts.push(`S${item.parentIndex} E${item.index}`);
  } else if (item.year) {
    parts.push(String(item.year));
  }
  const left = minutesLeft(item);
  if (left !== null) parts.push(`${left} min left`);
  else if (item.type === "episode") parts.push("Up next");
  return parts.join(" · ");
}

/** "1h 52m" / "45 min" — runtime, for things you haven't started yet. */
function formatRuntime(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)}h ${rest}m` : `${minutes / 60}h`;
}

/**
 * Recently-added entries have no view offset, so `describeItem`'s "N min
 * left" would be a lie — they get runtime (or episode count for a season).
 */
export function describeRecent(item: PlexMetadata): string {
  const parts: string[] = [];
  if (item.type === "episode" && item.parentIndex && item.index) {
    parts.push(`S${item.parentIndex} E${item.index}`);
  } else if (item.type === "season" && item.index) {
    parts.push(`Season ${item.index}`);
  } else if (item.year) {
    parts.push(String(item.year));
  }
  if (item.type === "season" || item.type === "show") {
    if (item.leafCount) parts.push(`${item.leafCount} episodes`);
  } else if (item.duration) {
    parts.push(formatRuntime(item.duration));
  }
  return parts.join(" · ") || "New in your library";
}

export function mapItems(
  metadata: PlexMetadata[],
  baseUrl: string,
  machineIdentifier: string | undefined,
  options: { kind?: PlexItemKind; limit?: number } = {},
): PlexItem[] {
  const kind = options.kind ?? "watching";
  return metadata.slice(0, options.limit ?? 6).map((entry, index) => {
    const progress =
      kind === "watching" && entry.duration && entry.viewOffset
        ? Math.min(100, Math.round((entry.viewOffset / entry.duration) * 100))
        : 0;
    // Landscape art for the hero, poster for the small queue tiles; fall
    // back through the show-level images an episode inherits.
    const artPath = entry.art ?? entry.grandparentArt ?? entry.thumb;
    const posterPath =
      entry.thumb ?? entry.parentThumb ?? entry.grandparentThumb ?? entry.art;
    // Episodes carry the show as grandparent, seasons as parent.
    const showTitle = entry.grandparentTitle ?? entry.parentTitle;
    return {
      id: entry.ratingKey ?? String(index),
      kind,
      title: entry.title ?? "Untitled",
      ...(showTitle ? { showTitle } : {}),
      detail: kind === "recent" ? describeRecent(entry) : describeItem(entry),
      progress,
      ...(artPath ? { artPath } : {}),
      ...(posterPath ? { posterPath } : {}),
      ...(machineIdentifier && entry.key
        ? {
            webUrl: `${baseUrl}/web/index.html#!/server/${machineIdentifier}/details?key=${encodeURIComponent(entry.key)}`,
          }
        : {}),
    };
  });
}

/** Video types only — a poster rail of new music albums isn't what this card is. */
const RECENT_TYPES = new Set(["movie", "show", "season", "episode"]);

/**
 * Parse the recently-added response into queue filler. Never throws: this is
 * decoration, and an old or grumpy server must not take the card down with it.
 */
export async function readRecentlyAdded(
  response: Response | null,
  baseUrl: string,
  machineIdentifier: string | undefined,
  exclude: Set<string>,
): Promise<PlexItem[]> {
  if (!response?.ok) return [];
  try {
    const body = (await response.json()) as {
      MediaContainer?: { Metadata?: PlexMetadata[] };
    };
    const metadata = (body.MediaContainer?.Metadata ?? []).filter(
      (entry) =>
        RECENT_TYPES.has(entry.type ?? "") &&
        !exclude.has(entry.ratingKey ?? ""),
    );
    return mapItems(metadata, baseUrl, machineIdentifier, {
      kind: "recent",
      limit: 8,
    });
  } catch {
    return [];
  }
}

/** Fetch server identity + the continue-watching hub for one connection. */
export async function fetchPlex(connection: PlexConnection): Promise<PlexState> {
  const headers = plexHeaders(connection);
  const signal = () => AbortSignal.timeout(10_000);
  try {
    const [rootResponse, deckResponse, recentResponse] = await Promise.all([
      fetch(`${connection.baseUrl}/`, { headers, signal: signal() }),
      // onDeck is supported by every server version; the newer
      // /hubs/continueWatching returns the same shape but only on recent ones.
      fetch(`${connection.baseUrl}/library/onDeck`, {
        headers,
        signal: signal(),
      }),
      // Most people are mid-way through exactly one thing, which leaves the
      // queue rail empty — recently added backfills it. Nice-to-have, so a
      // failure here degrades to an on-deck-only card rather than an error.
      fetch(
        `${connection.baseUrl}/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=16`,
        { headers, signal: signal() },
      ).catch(() => null),
    ]);
    if (rootResponse.status === 401 || deckResponse.status === 401) {
      return { configured: true, error: "unauthorized" };
    }
    if (!rootResponse.ok || !deckResponse.ok) {
      return { configured: true, error: "unreachable" };
    }

    let root: { MediaContainer?: { friendlyName?: string; machineIdentifier?: string } };
    let deck: { MediaContainer?: { Metadata?: PlexMetadata[] } };
    try {
      root = (await rootResponse.json()) as typeof root;
      deck = (await deckResponse.json()) as typeof deck;
    } catch {
      return { configured: true, error: "not-plex" };
    }
    if (!root?.MediaContainer?.machineIdentifier) {
      return { configured: true, error: "not-plex" };
    }

    const machineIdentifier = root.MediaContainer.machineIdentifier;
    const items = mapItems(
      deck.MediaContainer?.Metadata ?? [],
      connection.baseUrl,
      machineIdentifier,
    );
    return {
      configured: true,
      serverName:
        connection.label || root.MediaContainer.friendlyName || "Plex",
      items,
      recent: await readRecentlyAdded(
        recentResponse,
        connection.baseUrl,
        machineIdentifier,
        new Set(items.map((item) => item.id)),
      ),
    };
  } catch (error) {
    console.warn("plex:", (error as Error).message ?? error);
    return { configured: true, error: "unreachable" };
  }
}

/* ---------------- artwork proxy ---------------- */

interface ArtData {
  body: ArrayBuffer;
  contentType: string;
}

const ART_TTL_MS = 60 * 60 * 1000;
const ART_MAX = 120;
const artCache = new Map<string, { data: ArtData; expiresAt: number }>();
const artInflight = new Map<string, Promise<ArtData | null>>();

export function clearPlexArtCache(): void {
  artCache.clear();
}

/** Only Plex's own media paths may be proxied — not arbitrary URLs. */
export function isPlexArtPath(path: string): boolean {
  return /^\/(library|photo)\//.test(path);
}

/**
 * Fetch artwork through Plex's photo transcoder, which resizes server-side
 * so a poster wall doesn't pull full-resolution art over the wire.
 */
export function fetchPlexArt(
  path: string,
  width: number,
  height: number,
): Promise<ArtData | null> {
  const key = `${path}@${width}x${height}`;
  const cached = artCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.data);
  }
  const inflight = artInflight.get(key);
  if (inflight) return inflight;

  const download = (async (): Promise<ArtData | null> => {
    const connection = await resolvePlexConnection();
    if (!connection) return null;
    try {
      const transcode = new URL(`${connection.baseUrl}/photo/:/transcode`);
      transcode.searchParams.set("width", String(width));
      transcode.searchParams.set("height", String(height));
      transcode.searchParams.set("minSize", "1");
      transcode.searchParams.set("upscale", "1");
      transcode.searchParams.set("url", path);
      const response = await fetch(transcode, {
        headers: { "X-Plex-Token": connection.token },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        console.warn(`plex art ${path}: upstream ${response.status}`);
        return null;
      }
      const data: ArtData = {
        body: await response.arrayBuffer(),
        contentType: response.headers.get("content-type") ?? "image/jpeg",
      };
      if (artCache.size >= ART_MAX) {
        const oldest = artCache.keys().next().value;
        if (oldest !== undefined) artCache.delete(oldest);
      }
      artCache.set(key, { data, expiresAt: Date.now() + ART_TTL_MS });
      return data;
    } catch (error) {
      console.warn(`plex art ${path}:`, (error as Error).message ?? error);
      return null;
    } finally {
      artInflight.delete(key);
    }
  })();

  artInflight.set(key, download);
  return download;
}

/* ---------------- state cache ---------------- */

const CACHE_TTL_MS = 30_000;
let cache: { key: string; state: PlexState; expiresAt: number } | null = null;

export function clearPlexCache(): void {
  cache = null;
}

export async function getPlexState(): Promise<PlexState> {
  const connection = await resolvePlexConnection();
  if (!connection) return { configured: false };
  if (cache && cache.key === connection.baseUrl && cache.expiresAt > Date.now()) {
    return cache.state;
  }
  const state = await fetchPlex(connection);
  cache = {
    key: connection.baseUrl,
    state,
    expiresAt: Date.now() + (state.error ? 15_000 : CACHE_TTL_MS),
  };
  return state;
}
