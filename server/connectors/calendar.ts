import ical from "node-ical";
import type { ConnectionStore } from "../connection-store.ts";

/**
 * iCalendar (ICS) subscription connector. The feed URL is configured from the
 * calendar card's settings and stored server-side (connections.json) — private
 * ICS URLs are capability tokens and must never enter board.json.
 */

export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO timestamps — the client rehydrates into Dates. */
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  notes?: string;
}

export interface CalendarFeed {
  configured: boolean;
  events?: CalendarEvent[];
  error?: "unreachable" | "not-ics";
}

let connectionStore: ConnectionStore | null = null;

export function initCalendar(store: ConnectionStore): void {
  connectionStore = store;
}

/** The feed subscribed from the card's settings UI, if any. */
export async function resolveCalendarUrl(): Promise<{ url: string } | null> {
  const saved = await connectionStore?.loadCalendar();
  return saved ? { url: saved.url } : null;
}

/** webcal:// is the subscription scheme apps register — it's https underneath. */
export function normalizeIcsUrl(raw: string): string | null {
  const candidate = raw.trim().replace(/^webcal:\/\//i, "https://");
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

const WINDOW_DAYS = 60;
const MAX_EVENTS = 100;

interface RawEvent {
  type?: string;
  uid?: string;
  summary?: unknown;
  location?: unknown;
  description?: unknown;
  start?: Date;
  end?: Date;
  datetype?: string;
  rrule?: { between(after: Date, before: Date, inc?: boolean): Date[] };
  exdate?: Record<string, Date>;
  recurrences?: Record<string, RawEvent>;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "val" in value) {
    return String((value as { val: unknown }).val);
  }
  return "";
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toEvent(
  raw: RawEvent,
  start: Date,
  end: Date,
  occurrence: string,
): CalendarEvent {
  return {
    id: `${raw.uid ?? "event"}:${occurrence}`,
    title: textOf(raw.summary) || "Untitled event",
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: raw.datetype === "date",
    ...(textOf(raw.location) ? { location: textOf(raw.location) } : {}),
    ...(textOf(raw.description)
      ? { notes: textOf(raw.description).slice(0, 500) }
      : {}),
  };
}

/** Expand VEVENTs (including recurrences) into a bounded, sorted window. */
export function expandEvents(
  parsed: Record<string, unknown>,
  now: Date,
): CalendarEvent[] {
  const windowStart = new Date(now.getTime() - 24 * 3600_000);
  const windowEnd = new Date(now.getTime() + WINDOW_DAYS * 24 * 3600_000);
  const events: CalendarEvent[] = [];

  for (const value of Object.values(parsed)) {
    const raw = value as RawEvent;
    if (raw?.type !== "VEVENT" || !raw.start) continue;
    const durationMs = raw.end
      ? raw.end.getTime() - raw.start.getTime()
      : 3600_000;

    if (raw.rrule) {
      let occurrences: Date[];
      try {
        occurrences = raw.rrule.between(windowStart, windowEnd, true);
      } catch {
        continue;
      }
      for (const occurrence of occurrences.slice(0, MAX_EVENTS)) {
        const key = dayKey(occurrence);
        if (raw.exdate && Object.keys(raw.exdate).some((d) => d.startsWith(key))) {
          continue;
        }
        const override = raw.recurrences?.[key];
        if (override?.start) {
          events.push(
            toEvent(
              override,
              override.start,
              override.end ??
                new Date(override.start.getTime() + durationMs),
              key,
            ),
          );
        } else {
          events.push(
            toEvent(
              raw,
              occurrence,
              new Date(occurrence.getTime() + durationMs),
              key,
            ),
          );
        }
      }
    } else if (raw.start >= windowStart && raw.start <= windowEnd) {
      events.push(
        toEvent(
          raw,
          raw.start,
          raw.end ?? new Date(raw.start.getTime() + durationMs),
          dayKey(raw.start),
        ),
      );
    }
  }

  return events
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, MAX_EVENTS);
}

/** Fetch and parse a feed; distinguishes dead URLs from non-ICS responses. */
export async function fetchFeed(
  url: string,
  now = new Date(),
): Promise<CalendarFeed> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      redirect: "follow",
    });
    if (!response.ok) return { configured: true, error: "unreachable" };
    const text = await response.text();
    if (!text.includes("BEGIN:VCALENDAR")) {
      return { configured: true, error: "not-ics" };
    }
    const parsed = ical.sync.parseICS(text);
    return { configured: true, events: expandEvents(parsed, now) };
  } catch (error) {
    console.warn("calendar feed:", (error as Error).message ?? error);
    return { configured: true, error: "unreachable" };
  }
}

interface CacheEntry {
  feed: CalendarFeed;
  expiresAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { url: string; entry: CacheEntry } | null = null;

export function clearCalendarCache(): void {
  cache = null;
}

export async function getFeed(): Promise<CalendarFeed> {
  const connection = await resolveCalendarUrl();
  if (!connection) return { configured: false };
  if (
    cache &&
    cache.url === connection.url &&
    cache.entry.expiresAt > Date.now()
  ) {
    return cache.entry.feed;
  }
  const feed = await fetchFeed(connection.url);
  cache = {
    url: connection.url,
    entry: {
      feed,
      expiresAt: Date.now() + (feed.error ? 30_000 : CACHE_TTL_MS),
    },
  };
  return feed;
}
