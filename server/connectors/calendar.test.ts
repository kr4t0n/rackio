// @vitest-environment node
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import ical from "node-ical";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  expandEvents,
  fetchFeed,
  normalizeIcsUrl,
} from "./calendar.ts";

// Window reference for deterministic expansion.
const NOW = new Date("2026-07-20T12:00:00Z");

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//rackio//test//EN
BEGIN:VEVENT
UID:single-1
DTSTART:20260722T180000Z
DTEND:20260722T190000Z
SUMMARY:Rack maintenance window
LOCATION:Home rack
DESCRIPTION:Review service updates.
END:VEVENT
BEGIN:VEVENT
UID:weekly-1
DTSTART:20260721T093000Z
DTEND:20260721T100000Z
RRULE:FREQ=WEEKLY;COUNT=8
SUMMARY:Backup verification
END:VEVENT
BEGIN:VEVENT
UID:past-1
DTSTART:20250101T100000Z
DTEND:20250101T110000Z
SUMMARY:Long past event
END:VEVENT
BEGIN:VEVENT
UID:allday-1
DTSTART;VALUE=DATE:20260725
DTEND;VALUE=DATE:20260726
SUMMARY:Library day
END:VEVENT
END:VCALENDAR
`;

describe("normalizeIcsUrl", () => {
  it("converts webcal:// to https:// and validates schemes", () => {
    expect(normalizeIcsUrl("webcal://cal.example.com/feed.ics")).toBe(
      "https://cal.example.com/feed.ics",
    );
    expect(normalizeIcsUrl("https://cal.example.com/x.ics")).toBe(
      "https://cal.example.com/x.ics",
    );
    expect(normalizeIcsUrl("ftp://cal.example.com/x.ics")).toBeNull();
    expect(normalizeIcsUrl("not a url")).toBeNull();
  });
});

describe("expandEvents", () => {
  const parsed = ical.sync.parseICS(ICS);
  const events = expandEvents(parsed as Record<string, unknown>, NOW);

  it("includes single events inside the window, sorted", () => {
    const titles = events.map((event) => event.title);
    expect(titles).toContain("Rack maintenance window");
    const starts = events.map((event) => event.start);
    expect([...starts].sort()).toEqual(starts);
  });

  it("expands weekly recurrences into multiple occurrences", () => {
    const weekly = events.filter((event) => event.title === "Backup verification");
    expect(weekly.length).toBeGreaterThanOrEqual(4);
    expect(weekly[0].start).toBe("2026-07-21T09:30:00.000Z");
    expect(weekly[1].start).toBe("2026-07-28T09:30:00.000Z");
  });

  it("drops events far in the past and marks all-day events", () => {
    expect(events.some((event) => event.title === "Long past event")).toBe(false);
    const allDay = events.find((event) => event.title === "Library day");
    expect(allDay?.allDay).toBe(true);
  });
});

describe("fetchFeed", () => {
  const server = createServer((req, res) => {
    if (req.url === "/feed.ics") {
      res.setHeader("Content-Type", "text/calendar");
      return res.end(ICS);
    }
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><html><body>login</body></html>");
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
  afterAll(() => server.close());

  function base(): string {
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  it("parses a real feed", async () => {
    const feed = await fetchFeed(`${base()}/feed.ics`, NOW);
    expect(feed.error).toBeUndefined();
    expect(feed.events?.length).toBeGreaterThan(3);
  });

  it("flags non-ICS responses distinctly", async () => {
    const feed = await fetchFeed(`${base()}/whatever`, NOW);
    expect(feed.error).toBe("not-ics");
  });

  it("flags unreachable hosts", async () => {
    const feed = await fetchFeed("http://127.0.0.1:1/feed.ics", NOW);
    expect(feed.error).toBe("unreachable");
  });
});
