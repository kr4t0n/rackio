import type {
  DownloaderConnection,
  ConnectionStore,
} from "../connection-store.ts";

/**
 * Torrent client connector supporting qBittorrent (WebUI API v2) and
 * Transmission (RPC). Unlike the other integrations this one is **per card
 * instance** — Kyle runs several clients, so each downloader card holds its
 * own connection, keyed by the card's id in connections.json.
 *
 * Neither client exposes a throughput history, so the server keeps a small
 * in-memory ring of download-rate samples per instance to feed the chart.
 */

export type DownloaderKind = "qbittorrent" | "transmission";

export type TransferState =
  | "downloading"
  | "seeding"
  | "queued"
  | "paused"
  | "checking"
  | "done";

export interface DownloaderTransfer {
  id: string;
  name: string;
  /** 0–100. */
  progress: number;
  state: TransferState;
  downSpeed: number;
  upSpeed: number;
  /** Seconds remaining; omitted when unknown//infinite. */
  eta?: number;
}

export interface DownloaderStats {
  configured: boolean;
  kind?: DownloaderKind;
  clientName?: string;
  downSpeed?: number;
  upSpeed?: number;
  activeCount?: number;
  totalCount?: number;
  transfers?: DownloaderTransfer[];
  /** Download-rate samples (bytes/s), oldest → newest. */
  history?: number[];
  /** Seconds since each sample, aligned with history. */
  historyAges?: number[];
  error?: "unauthorized" | "unreachable" | "not-client";
}

let connectionStore: ConnectionStore | null = null;

export function initDownloader(store: ConnectionStore): void {
  connectionStore = store;
}

export async function resolveDownloader(
  instanceId: string,
): Promise<DownloaderConnection | null> {
  return (await connectionStore?.loadDownloader(instanceId)) ?? null;
}

export function normalizeBaseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const path = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/(api\/v2|transmission)(\/.*)?$/, "")
    .replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

function basicAuth(connection: DownloaderConnection): Record<string, string> {
  if (!connection.user) return {};
  const token = Buffer.from(`${connection.user}:${connection.password}`).toString(
    "base64",
  );
  return { Authorization: `Basic ${token}` };
}

/* ---------------- qBittorrent ---------------- */

/** qBittorrent state strings → our normalized set. */
export function mapQbitState(state: string): TransferState {
  if (state.startsWith("paused") || state.startsWith("stopped")) return "paused";
  if (state.startsWith("queued")) return "queued";
  if (state.startsWith("checking") || state === "moving") return "checking";
  if (state === "uploading" || state === "stalledUP" || state === "forcedUP") {
    return "seeding";
  }
  if (state === "pausedUP") return "done";
  return "downloading";
}

interface QbitTorrent {
  hash?: string;
  name?: string;
  progress?: number;
  dlspeed?: number;
  upspeed?: number;
  eta?: number;
  state?: string;
}

const sessionCookies = new Map<string, { cookie: string; expiresAt: number }>();

async function qbitLogin(connection: DownloaderConnection): Promise<string | null> {
  const cached = sessionCookies.get(connection.baseUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.cookie;

  const response = await fetch(`${connection.baseUrl}/api/v2/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username: connection.user,
      password: connection.password,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();
  if (!response.ok || body.trim() === "Fails.") return null;
  const raw = response.headers.get("set-cookie") ?? "";
  const sid = raw.match(/SID=[^;]+/)?.[0] ?? "";
  // Some setups (auth bypassed for local subnets) return Ok. with no cookie.
  const cookie = sid || "";
  sessionCookies.set(connection.baseUrl, {
    cookie,
    expiresAt: Date.now() + 25 * 60_000,
  });
  return cookie;
}

async function fetchQbit(
  connection: DownloaderConnection,
): Promise<DownloaderStats> {
  const cookie = await qbitLogin(connection);
  if (cookie === null) return { configured: true, error: "unauthorized" };
  const headers: Record<string, string> = cookie ? { Cookie: cookie } : {};

  const [transferResponse, torrentsResponse] = await Promise.all([
    fetch(`${connection.baseUrl}/api/v2/transfer/info`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    }),
    fetch(`${connection.baseUrl}/api/v2/torrents/info?sort=dlspeed&reverse=true&limit=8`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    }),
  ]);
  if (transferResponse.status === 403 || torrentsResponse.status === 403) {
    sessionCookies.delete(connection.baseUrl);
    return { configured: true, error: "unauthorized" };
  }
  if (!transferResponse.ok || !torrentsResponse.ok) {
    return { configured: true, error: "unreachable" };
  }

  let transfer: { dl_info_speed?: number; up_info_speed?: number };
  let torrents: QbitTorrent[];
  try {
    transfer = (await transferResponse.json()) as typeof transfer;
    torrents = (await torrentsResponse.json()) as QbitTorrent[];
  } catch {
    return { configured: true, error: "not-client" };
  }
  if (typeof transfer?.dl_info_speed !== "number" || !Array.isArray(torrents)) {
    return { configured: true, error: "not-client" };
  }

  const transfers: DownloaderTransfer[] = torrents.map((torrent, index) => ({
    id: torrent.hash ?? String(index),
    name: torrent.name ?? "Unknown",
    progress: Math.round((torrent.progress ?? 0) * 100),
    state: mapQbitState(torrent.state ?? ""),
    downSpeed: torrent.dlspeed ?? 0,
    upSpeed: torrent.upspeed ?? 0,
    // qBittorrent uses 8640000 as "unknown/infinite".
    ...(torrent.eta && torrent.eta > 0 && torrent.eta < 8_640_000
      ? { eta: torrent.eta }
      : {}),
  }));

  return {
    configured: true,
    kind: "qbittorrent",
    clientName: "qBittorrent",
    downSpeed: transfer.dl_info_speed ?? 0,
    upSpeed: transfer.up_info_speed ?? 0,
    activeCount: transfers.filter(
      (item) => item.state === "downloading" || item.state === "seeding",
    ).length,
    totalCount: transfers.length,
    transfers,
  };
}

/* ---------------- Transmission ---------------- */

/** Transmission numeric status → our normalized set. */
export function mapTransmissionState(status: number, percent: number): TransferState {
  switch (status) {
    case 0:
      return percent >= 1 ? "done" : "paused";
    case 1:
    case 2:
      return "checking";
    case 3:
    case 5:
      return "queued";
    case 6:
      return "seeding";
    default:
      return "downloading";
  }
}

const sessionIds = new Map<string, string>();

async function transmissionRpc(
  connection: DownloaderConnection,
  body: unknown,
  retry = true,
): Promise<Response> {
  const sessionId = sessionIds.get(connection.baseUrl) ?? "";
  const response = await fetch(`${connection.baseUrl}/transmission/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...basicAuth(connection),
      ...(sessionId ? { "X-Transmission-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  // 409 carries the CSRF token Transmission expects on the next call.
  if (response.status === 409 && retry) {
    const next = response.headers.get("x-transmission-session-id");
    if (next) {
      sessionIds.set(connection.baseUrl, next);
      return transmissionRpc(connection, body, false);
    }
  }
  return response;
}

interface TransmissionTorrent {
  id?: number;
  name?: string;
  percentDone?: number;
  rateDownload?: number;
  rateUpload?: number;
  status?: number;
  eta?: number;
}

async function fetchTransmission(
  connection: DownloaderConnection,
): Promise<DownloaderStats> {
  const [statsResponse, torrentsResponse] = await Promise.all([
    transmissionRpc(connection, { method: "session-stats" }),
    transmissionRpc(connection, {
      method: "torrent-get",
      arguments: {
        fields: [
          "id",
          "name",
          "percentDone",
          "rateDownload",
          "rateUpload",
          "status",
          "eta",
        ],
      },
    }),
  ]);
  if (statsResponse.status === 401 || torrentsResponse.status === 401) {
    return { configured: true, error: "unauthorized" };
  }
  if (!statsResponse.ok || !torrentsResponse.ok) {
    return { configured: true, error: "unreachable" };
  }

  let stats: {
    arguments?: {
      downloadSpeed?: number;
      uploadSpeed?: number;
      activeTorrentCount?: number;
      torrentCount?: number;
    };
  };
  let torrentsBody: { arguments?: { torrents?: TransmissionTorrent[] } };
  try {
    stats = (await statsResponse.json()) as typeof stats;
    torrentsBody = (await torrentsResponse.json()) as typeof torrentsBody;
  } catch {
    return { configured: true, error: "not-client" };
  }
  if (typeof stats?.arguments?.downloadSpeed !== "number") {
    return { configured: true, error: "not-client" };
  }

  const torrents = torrentsBody.arguments?.torrents ?? [];
  const transfers: DownloaderTransfer[] = torrents
    .map((torrent, index) => {
      const percent = torrent.percentDone ?? 0;
      return {
        id: String(torrent.id ?? index),
        name: torrent.name ?? "Unknown",
        progress: Math.round(percent * 100),
        state: mapTransmissionState(torrent.status ?? 4, percent),
        downSpeed: torrent.rateDownload ?? 0,
        upSpeed: torrent.rateUpload ?? 0,
        ...(torrent.eta && torrent.eta > 0 ? { eta: torrent.eta } : {}),
      };
    })
    .sort((a, b) => b.downSpeed - a.downSpeed)
    .slice(0, 8);

  return {
    configured: true,
    kind: "transmission",
    clientName: "Transmission",
    downSpeed: stats.arguments.downloadSpeed ?? 0,
    upSpeed: stats.arguments.uploadSpeed ?? 0,
    activeCount: stats.arguments.activeTorrentCount ?? 0,
    totalCount: stats.arguments.torrentCount ?? transfers.length,
    transfers,
  };
}

/** Probe one client with an explicit connection (used by connect + polling). */
export async function fetchDownloader(
  connection: DownloaderConnection,
): Promise<DownloaderStats> {
  try {
    return connection.kind === "transmission"
      ? await fetchTransmission(connection)
      : await fetchQbit(connection);
  } catch (error) {
    console.warn("downloader:", (error as Error).message ?? error);
    return { configured: true, error: "unreachable" };
  }
}

/* ---------------- history + cache ---------------- */

const HISTORY_MAX = 18;
const history = new Map<string, Array<{ at: number; down: number }>>();

export function clearDownloaderState(instanceId?: string): void {
  if (instanceId) {
    history.delete(instanceId);
    cache.delete(instanceId);
    return;
  }
  history.clear();
  cache.clear();
}

function recordSample(instanceId: string, down: number): void {
  const samples = history.get(instanceId) ?? [];
  samples.push({ at: Date.now(), down });
  history.set(instanceId, samples.slice(-HISTORY_MAX));
}

const CACHE_TTL_MS = 4_000;
const cache = new Map<string, { stats: DownloaderStats; expiresAt: number }>();

export async function getDownloaderStats(
  instanceId: string,
): Promise<DownloaderStats> {
  const connection = await resolveDownloader(instanceId);
  if (!connection) return { configured: false };

  const cached = cache.get(instanceId);
  if (cached && cached.expiresAt > Date.now()) return cached.stats;

  const stats = await fetchDownloader(connection);
  if (!stats.error) {
    recordSample(instanceId, stats.downSpeed ?? 0);
    if (connection.label) stats.clientName = connection.label;
  }
  const samples = history.get(instanceId) ?? [];
  const now = Date.now();
  const withHistory: DownloaderStats = {
    ...stats,
    history: samples.map((sample) => sample.down),
    historyAges: samples.map((sample) => Math.round((now - sample.at) / 1000)),
  };
  cache.set(instanceId, {
    stats: withHistory,
    expiresAt: now + (stats.error ? 10_000 : CACHE_TTL_MS),
  });
  return withHistory;
}
