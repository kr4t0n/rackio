import { XMLParser } from "fast-xml-parser";

/**
 * Calibre-Web connector via its OPDS catalog (Atom XML). Connection settings
 * come from the environment — credentials never live in board.json:
 *   CALIBRE_BASE_URL, CALIBRE_USER, CALIBRE_PASSWORD
 *
 * Note: Calibre-Web does not expose reading progress through any API
 * (it's Kobo-sync-only), so the card ships shelves + deep links, no % bar.
 */

export type CalibreSource = "new" | "hot";

export interface CalibreBook {
  id: number;
  title: string;
  author: string;
}

export interface CalibreShelf {
  configured: boolean;
  /** Public base URL for deep links into the Calibre-Web UI. */
  webUrl?: string;
  books?: CalibreBook[];
  error?: "unauthorized" | "unreachable";
}

export interface CalibreEnv {
  baseUrl?: string;
  user?: string;
  password?: string;
}

export function calibreEnv(): CalibreEnv {
  return {
    baseUrl: process.env.CALIBRE_BASE_URL?.replace(/\/+$/, ""),
    user: process.env.CALIBRE_USER,
    password: process.env.CALIBRE_PASSWORD,
  };
}

export function authHeaders(env: CalibreEnv): Record<string, string> {
  if (!env.user) return {};
  const token = Buffer.from(`${env.user}:${env.password ?? ""}`).toString(
    "base64",
  );
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
    books.push({
      id,
      title: textOf(entry.title) || "Untitled",
      author: authors
        .map((a) => textOf((a as { name?: unknown }).name))
        .filter(Boolean)
        .join(", "),
    });
  }
  return books;
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
  const env = calibreEnv();
  if (!env.baseUrl) return { configured: false };

  const cached = cache.get(source);
  if (cached && cached.expiresAt > Date.now()) return cached.shelf;

  let shelf: CalibreShelf;
  try {
    const response = await fetch(`${env.baseUrl}/opds/${source}`, {
      headers: authHeaders(env),
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) {
      shelf = { configured: true, error: "unauthorized" };
    } else if (!response.ok) {
      shelf = { configured: true, error: "unreachable" };
    } else {
      shelf = {
        configured: true,
        webUrl: env.baseUrl,
        books: parseOpdsFeed(await response.text()).slice(0, 8),
      };
    }
  } catch {
    shelf = { configured: true, error: "unreachable" };
  }

  // Cache errors briefly too, so a down library doesn't get hammered.
  cache.set(source, {
    shelf,
    expiresAt: Date.now() + (shelf.error ? 30_000 : CACHE_TTL_MS),
  });
  return shelf;
}

/** Proxy a cover image (adds auth; the browser never sees credentials). */
export async function fetchCover(
  id: number,
): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  const env = calibreEnv();
  if (!env.baseUrl) return null;
  try {
    const response = await fetch(`${env.baseUrl}/opds/cover/${id}`, {
      headers: authHeaders(env),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    return {
      body: await response.arrayBuffer(),
      contentType: response.headers.get("content-type") ?? "image/jpeg",
    };
  } catch {
    return null;
  }
}
