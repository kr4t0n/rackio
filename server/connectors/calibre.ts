import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import type {
  CalibreConnection,
  ConnectionStore,
} from "../connection-store.ts";

/**
 * Calibre-Web connector via its OPDS catalog (Atom XML). Connection settings
 * come from the card's settings UI (persisted server-side in DATA_DIR/
 * connections.json — never in board.json) or from CALIBRE_* env vars, which
 * take precedence when set (the k8s/Docker deployment path).
 *
 * Note: Calibre-Web does not expose reading progress through any API
 * (it's Kobo-sync-only), so the card ships shelves + deep links, no % bar.
 */

export type CalibreSource = "new" | "hot";

export interface CalibreBook {
  id: number;
  title: string;
  author: string;
  /** Plain-text description, trimmed server-side (OPDS summaries carry HTML). */
  summary?: string;
  /** ISO date the book entered the library. */
  published?: string;
}

export interface CalibreShelf {
  configured: boolean;
  /** Public base URL for deep links into the Calibre-Web UI. */
  webUrl?: string;
  books?: CalibreBook[];
  error?: "unauthorized" | "unreachable" | "not-opds";
}

let connectionStore: ConnectionStore | null = null;
let coversDir: string | null = null;

export function initCalibre(store: ConnectionStore, dataDir?: string): void {
  connectionStore = store;
  coversDir = dataDir ? join(dataDir, "covers") : null;
}

export type ConnectionSource = "env" | "saved";

export interface ResolvedConnection extends CalibreConnection {
  source: ConnectionSource;
}

/** Env vars win (deployment-managed); otherwise the UI-saved connection. */
export async function resolveConnection(): Promise<ResolvedConnection | null> {
  const envBase = process.env.CALIBRE_BASE_URL?.replace(/\/+$/, "");
  if (envBase) {
    return {
      source: "env",
      baseUrl: envBase,
      user: process.env.CALIBRE_USER ?? "",
      password: process.env.CALIBRE_PASSWORD ?? "",
    };
  }
  const saved = await connectionStore?.loadCalibre();
  return saved ? { ...saved, source: "saved" } : null;
}

export function authHeaders(connection: {
  user: string;
  password: string;
}): Record<string, string> {
  if (!connection.user) return {};
  const token = Buffer.from(
    `${connection.user}:${connection.password}`,
  ).toString("base64");
  return { Authorization: `Basic ${token}` };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

/** Extract the numeric book id from an OPDS link href like /opds/cover/42. */
function bookIdFromLinks(links: Array<{ "@_href"?: string }>): number | null {
  for (const link of links) {
    const match = link["@_href"]?.match(/\/cover\/(\d+)/);
    if (match) return Number(match[1]);
  }
  return null;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && "#text" in value) {
    return String((value as { "#text": unknown })["#text"]);
  }
  return "";
}

/** Depth-first text of a parsed XML subtree (content type="xhtml" nests
 *  real elements, so the parser yields an object tree, not a string). */
function collectText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(collectText).join(" ");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .filter(([key]) => !key.startsWith("@_"))
      .map(([, child]) => collectText(child))
      .join(" ");
  }
  return "";
}

/** Calibre-Web's "there is no description" placeholders, per UI language. */
const NO_SUMMARY = /^(无简介|no description available\.?|keine beschreibung.*)$/i;

/** OPDS summaries embed HTML — reduce to trimmed plain text for the card. */
export function plainSummary(value: unknown, maxLength = 300): string {
  const text = collectText(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) =>
      ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " })[
        e as string
      ] ?? " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (NO_SUMMARY.test(text)) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).replace(/\s+\S*$/, "")}…`;
}

/**
 * Parse a Calibre-Web OPDS acquisition feed. `valid` distinguishes a real
 * (possibly empty) Atom feed from arbitrary HTML — e.g. the login page that
 * comes back with HTTP 200 when the base URL is wrong.
 */
export function parseOpdsDocument(xml: string): {
  valid: boolean;
  books: CalibreBook[];
} {
  let doc: { feed?: { entry?: unknown } };
  try {
    doc = parser.parse(xml) as { feed?: { entry?: unknown } };
  } catch {
    return { valid: false, books: [] };
  }
  if (!doc.feed || typeof doc.feed !== "object") {
    return { valid: false, books: [] };
  }
  return { valid: true, books: parseOpdsFeed(xml) };
}

/**
 * Candidate base URLs for whatever the user pasted, most specific first.
 * Handles address-bar pastes (login pages, query strings, /opds itself)
 * while preserving genuine sub-path mounts like https://nas.lan/calibre.
 */
export function baseUrlCandidates(raw: string): string[] {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return [];
  }
  let path = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/(login|logout|register)$/, "")
    .replace(/\/opds(\/.*)?$/, "");
  path = path.replace(/\/+$/, "");
  const candidates = [`${url.origin}${path}`];
  if (path) candidates.push(url.origin);
  return candidates;
}

/** Parse a Calibre-Web OPDS acquisition feed into a book list. */
export function parseOpdsFeed(xml: string): CalibreBook[] {
  const doc = parser.parse(xml) as {
    feed?: { entry?: unknown };
  };
  const rawEntries = doc.feed?.entry;
  if (!rawEntries) return [];
  const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];

  const books: CalibreBook[] = [];
  for (const entry of entries as Array<Record<string, unknown>>) {
    const rawLinks = entry.link;
    const links = (
      Array.isArray(rawLinks) ? rawLinks : rawLinks ? [rawLinks] : []
    ) as Array<{ "@_href"?: string }>;
    const id = bookIdFromLinks(links);
    if (id === null) continue;
    const rawAuthor = entry.author;
    const authors = Array.isArray(rawAuthor)
      ? rawAuthor
      : rawAuthor
        ? [rawAuthor]
        : [];
    const summary = plainSummary(entry.summary ?? entry.content);
    const published = textOf(entry.published);
    books.push({
      id,
      title: textOf(entry.title) || "Untitled",
      author: authors
        .map((a) => textOf((a as { name?: unknown }).name))
        .filter(Boolean)
        .join(", "),
      ...(summary ? { summary } : {}),
      ...(published ? { published } : {}),
    });
  }
  return books;
}

/** Fetch and parse one OPDS feed with the given connection. */
export async function fetchShelf(
  connection: CalibreConnection,
  source: CalibreSource,
): Promise<CalibreShelf> {
  try {
    const response = await fetch(`${connection.baseUrl}/opds/${source}`, {
      headers: authHeaders(connection),
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) {
      return { configured: true, error: "unauthorized" };
    }
    if (!response.ok) return { configured: true, error: "unreachable" };
    const document = parseOpdsDocument(await response.text());
    if (!document.valid) return { configured: true, error: "not-opds" };
    return {
      configured: true,
      webUrl: connection.baseUrl,
      books: document.books.slice(0, 9), // 1 feature + up to 8 shelf covers
    };
  } catch {
    return { configured: true, error: "unreachable" };
  }
}

interface CacheEntry {
  shelf: CalibreShelf;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<CalibreSource, CacheEntry>();

export function clearCalibreCache(): void {
  cache.clear();
}

export async function getShelf(source: CalibreSource): Promise<CalibreShelf> {
  const connection = await resolveConnection();
  if (!connection) return { configured: false };

  const cached = cache.get(source);
  if (cached && cached.expiresAt > Date.now()) return cached.shelf;

  const shelf = await fetchShelf(connection, source);
  // Cache errors briefly too, so a down library doesn't get hammered.
  cache.set(source, {
    shelf,
    expiresAt: Date.now() + (shelf.error ? 30_000 : CACHE_TTL_MS),
  });
  return shelf;
}

/**
 * Cover proxying. A board fires a dozen cover requests at once, but the link
 * to the library may be slow — naive parallel downloads share the bandwidth
 * and all crawl into the timeout. So: covers are cached in memory (they're
 * effectively immutable), concurrent requests for the same id share one
 * download, and at most COVER_CONCURRENCY distinct downloads run upstream.
 */

interface CoverData {
  body: ArrayBuffer;
  contentType: string;
}

const COVER_TTL_MS = 6 * 60 * 60 * 1000;
const COVER_CACHE_MAX = 300;
const coverCache = new Map<number, { data: CoverData; expiresAt: number }>();
const coverInflight = new Map<number, Promise<CoverData | null>>();

const COVER_CONCURRENCY = 3;
let coverSlots = COVER_CONCURRENCY;
const coverWaiters: Array<() => void> = [];

function rememberCover(id: number, data: CoverData): void {
  if (coverCache.size >= COVER_CACHE_MAX) {
    const oldest = coverCache.keys().next().value;
    if (oldest !== undefined) coverCache.delete(oldest);
  }
  coverCache.set(id, { data, expiresAt: Date.now() + COVER_TTL_MS });
}

async function withCoverSlot<T>(task: () => Promise<T>): Promise<T> {
  if (coverSlots === 0) {
    await new Promise<void>((resolve) => coverWaiters.push(resolve));
  } else {
    coverSlots -= 1;
  }
  try {
    return await task();
  } finally {
    const next = coverWaiters.shift();
    if (next) next();
    else coverSlots += 1;
  }
}

export function clearCoverCache(): void {
  coverCache.clear();
}

/** Covers persist to DATA_DIR/covers so the slow first download happens once
 *  per book ever, surviving server restarts. Best-effort — disk errors fall
 *  back to re-downloading. */
async function readCoverFromDisk(id: number): Promise<CoverData | null> {
  if (!coversDir) return null;
  try {
    const [body, contentType] = await Promise.all([
      readFile(join(coversDir, String(id))),
      readFile(join(coversDir, `${id}.type`), "utf8"),
    ]);
    return {
      body: body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      ) as ArrayBuffer,
      contentType: contentType.trim() || "image/jpeg",
    };
  } catch {
    return null;
  }
}

async function writeCoverToDisk(id: number, data: CoverData): Promise<void> {
  if (!coversDir) return;
  try {
    await mkdir(coversDir, { recursive: true });
    await writeFile(join(coversDir, String(id)), Buffer.from(data.body));
    await writeFile(join(coversDir, `${id}.type`), data.contentType, "utf8");
  } catch {
    // Best-effort — memory cache still applies for this process.
  }
}

/** Proxy a cover image (adds auth; the browser never sees credentials). */
export function fetchCover(id: number): Promise<CoverData | null> {
  const cached = coverCache.get(id);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.data);
  }
  const inflight = coverInflight.get(id);
  if (inflight) return inflight;

  const download = (async (): Promise<CoverData | null> => {
    try {
      const fromDisk = await readCoverFromDisk(id);
      if (fromDisk) {
        rememberCover(id, fromDisk);
        return fromDisk;
      }
      const connection = await resolveConnection();
      if (!connection) return null;
      return await withCoverSlot(async () => {
        const response = await fetch(`${connection.baseUrl}/opds/cover/${id}`, {
          headers: authHeaders(connection),
          // The library link can be very slow (~150KB covers taking 30s+).
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) {
          console.warn(`calibre cover ${id}: upstream ${response.status}`);
          return null;
        }
        const data: CoverData = {
          body: await response.arrayBuffer(),
          contentType: response.headers.get("content-type") ?? "image/jpeg",
        };
        rememberCover(id, data);
        await writeCoverToDisk(id, data);
        return data;
      });
    } catch (error) {
      console.warn(`calibre cover ${id}:`, (error as Error).message ?? error);
      return null;
    } finally {
      coverInflight.delete(id);
    }
  })();

  coverInflight.set(id, download);
  return download;
}
