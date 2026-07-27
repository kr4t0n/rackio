import type { ConnectionStore, DockerHubConnection } from "../connection-store.ts";

/**
 * Docker Hub connector. Lists a namespace's images with the tag you'd
 * actually pull, plus the detail a rack owner wants before pulling: digest,
 * size, architectures and age.
 *
 * Unlike every other connector this one talks to the public internet rather
 * than the rack, and credentials are optional — Hub serves a namespace's
 * public repositories anonymously. A username + personal access token only
 * buys visibility of private repositories (and a higher rate limit).
 */

const HUB_API = "https://hub.docker.com";

export interface DockerTag {
  name: string;
  digest?: string;
  sizeBytes?: number;
  /** e.g. ["amd64", "arm64"]; attestation manifests are dropped. */
  architectures: string[];
  /** ISO — formatted client-side so it doesn't go stale inside the cache. */
  updatedAt?: string;
}

export interface DockerImage {
  /** "namespace/repo", the name you'd type. */
  name: string;
  repo: string;
  isPrivate: boolean;
  description?: string;
  webUrl: string;
  /**
   * Both candidates travel together so the *card* can choose: watching
   * releases and watching an actively-developed project want different tags,
   * and two cards can want different things from one cached response.
   */
  release: DockerTag;
  newest: DockerTag;
}

export interface DockerHubState {
  configured: boolean;
  namespace?: string;
  label?: string;
  /** False when reading anonymously — private repositories stay hidden. */
  authenticated?: boolean;
  images?: DockerImage[];
  error?: "unauthorized" | "unreachable" | "not-found";
}

let connectionStore: ConnectionStore | null = null;

export function initDockerHub(store: ConnectionStore): void {
  connectionStore = store;
}

export async function resolveDockerHubConnection(): Promise<DockerHubConnection | null> {
  return (await connectionStore?.loadDockerHub()) ?? null;
}

/**
 * People paste whatever the browser was showing: a bare handle, their profile
 * URL, or a link to one repository. All of them identify a namespace.
 */
export function normalizeNamespace(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  const match = value.match(
    /hub\.docker\.com\/(?:u\/|r\/|repository\/docker\/)?([^/?#]+)/i,
  );
  if (match) value = match[1];
  value = value.replace(/^\/+|\/+$/g, "").split("/")[0].toLowerCase();
  // Hub namespaces are the usual DNS-ish handle charset.
  return /^[a-z0-9][a-z0-9_-]{0,254}$/.test(value) ? value : null;
}

interface HubRepository {
  name?: string;
  namespace?: string;
  description?: string;
  is_private?: boolean;
  last_updated?: string;
}

interface HubTag {
  name?: string;
  last_updated?: string;
  full_size?: number;
  digest?: string;
  images?: Array<{ architecture?: string; os?: string }>;
}

const byNewest = <T extends { last_updated?: string }>(a: T, b: T) =>
  Date.parse(b.last_updated ?? "") - Date.parse(a.last_updated ?? "");

/**
 * The tag a person would actually pull. A real version wins (that's what the
 * card is for); otherwise `latest`, which is what most people type; only then
 * the newest tag of any shape, so CI-only repos still show something true.
 */
export function pickTag(tags: HubTag[]): HubTag | null {
  const named = tags.filter((tag) => tag.name);
  if (named.length === 0) return null;
  const newestFirst = [...named].sort(byNewest);
  return (
    newestFirst.find((tag) => /^v?\d+(\.\d+)*(?:[-+].*)?$/.test(tag.name ?? "")) ??
    newestFirst.find((tag) => tag.name === "latest") ??
    newestFirst[0]
  );
}

/** buildx pushes attestation manifests that report as "unknown". */
export function architecturesOf(tag: HubTag): string[] {
  const found = (tag.images ?? [])
    .map((image) => image.architecture)
    .filter((arch): arch is string => Boolean(arch) && arch !== "unknown");
  return [...new Set(found)];
}

function toDockerTag(tag: HubTag, fallbackUpdatedAt?: string): DockerTag {
  return {
    name: tag.name ?? "latest",
    ...(tag.digest ? { digest: tag.digest } : {}),
    ...(tag.full_size ? { sizeBytes: tag.full_size } : {}),
    architectures: architecturesOf(tag),
    ...(tag.last_updated ?? fallbackUpdatedAt
      ? { updatedAt: tag.last_updated ?? fallbackUpdatedAt }
      : {}),
  };
}

/** Null when the repository has no tags at all — the caller drops it. */
export function mapImage(
  repository: HubRepository,
  tags: HubTag[],
  namespace: string,
): DockerImage | null {
  const release = pickTag(tags);
  if (!release) return null;
  // Newest by push time, whatever its shape — usually the CI sha-* tag.
  const newest = [...tags.filter((tag) => tag.name)].sort(byNewest)[0] ?? release;
  const repo = repository.name ?? "";
  return {
    name: `${namespace}/${repo}`,
    repo,
    isPrivate: Boolean(repository.is_private),
    ...(repository.description?.trim()
      ? { description: repository.description.trim() }
      : {}),
    webUrl: `https://hub.docker.com/r/${namespace}/${repo}`,
    release: toDockerTag(release, repository.last_updated),
    newest: toDockerTag(newest, repository.last_updated),
  };
}

/* ---------------- auth ---------------- */

const TOKEN_TTL_MS = 20 * 60 * 1000;
let tokenCache: { key: string; token: string; expiresAt: number } | null = null;

export function clearDockerHubToken(): void {
  tokenCache = null;
}

/**
 * Exchange username + personal access token for a session JWT. Returns null
 * on bad credentials so callers can report `unauthorized` distinctly from a
 * network failure.
 */
async function login(
  username: string,
  token: string,
  apiBase: string,
): Promise<string | null> {
  const key = `${apiBase}:${username}`;
  if (tokenCache && tokenCache.key === key && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }
  const response = await fetch(`${apiBase}/v2/users/login/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ username, password: token }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { token?: string };
  if (!body.token) return null;
  tokenCache = { key, token: body.token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return body.token;
}

/* ---------------- fetch ---------------- */

/** How many repositories we pull tags for; the big footprint shows four. */
const IMAGE_LIMIT = 6;

export async function fetchDockerHub(
  connection: DockerHubConnection,
  apiBase = HUB_API,
): Promise<DockerHubState> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let authenticated = false;
  try {
    if (connection.username && connection.token) {
      const jwt = await login(connection.username, connection.token, apiBase);
      if (!jwt) return { configured: true, error: "unauthorized" };
      headers.Authorization = `JWT ${jwt}`;
      authenticated = true;
    }

    const listUrl = `${apiBase}/v2/repositories/${encodeURIComponent(connection.namespace)}/?page_size=100`;
    const listResponse = await fetch(listUrl, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (listResponse.status === 401 || listResponse.status === 403) {
      return { configured: true, error: "unauthorized" };
    }
    if (listResponse.status === 404) {
      return { configured: true, error: "not-found" };
    }
    if (!listResponse.ok) return { configured: true, error: "unreachable" };

    const list = (await listResponse.json()) as { results?: HubRepository[] };
    const repositories = (list.results ?? [])
      .filter((repository) => repository.name)
      .sort(byNewest)
      .slice(0, IMAGE_LIMIT);

    // One tag request per repository — capped by IMAGE_LIMIT, and a repo whose
    // tags fail to load is dropped rather than shown with a missing tag.
    const images = (
      await Promise.all(
        repositories.map(async (repository) => {
          try {
            const tagsUrl = `${apiBase}/v2/repositories/${encodeURIComponent(connection.namespace)}/${encodeURIComponent(repository.name ?? "")}/tags/?page_size=25&ordering=last_updated`;
            const response = await fetch(tagsUrl, {
              headers,
              signal: AbortSignal.timeout(15_000),
            });
            if (!response.ok) return null;
            const body = (await response.json()) as { results?: HubTag[] };
            return mapImage(repository, body.results ?? [], connection.namespace);
          } catch {
            return null;
          }
        }),
      )
    ).filter((image): image is DockerImage => image !== null);

    return {
      configured: true,
      namespace: connection.namespace,
      ...(connection.label ? { label: connection.label } : {}),
      authenticated,
      images,
    };
  } catch (error) {
    console.warn("dockerhub:", (error as Error).message ?? error);
    return { configured: true, error: "unreachable" };
  }
}

/* ---------------- state cache ---------------- */

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { key: string; state: DockerHubState; expiresAt: number } | null = null;

export function clearDockerHubCache(): void {
  cache = null;
}

export async function getDockerHubState(): Promise<DockerHubState> {
  const connection = await resolveDockerHubConnection();
  if (!connection) return { configured: false };
  const key = `${connection.namespace}:${connection.username ?? ""}`;
  if (cache && cache.key === key && cache.expiresAt > Date.now()) {
    return cache.state;
  }
  const state = await fetchDockerHub(connection);
  cache = {
    key,
    state,
    expiresAt: Date.now() + (state.error ? 60_000 : CACHE_TTL_MS),
  };
  return state;
}
