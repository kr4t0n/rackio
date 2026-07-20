// @vitest-environment node
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createConnectionStore } from "../connection-store.ts";
import {
  authHeaders,
  baseUrlCandidates,
  clearCalibreCache,
  clearCoverCache,
  fetchCover,
  fetchShelf,
  getShelf,
  initCalibre,
  parseOpdsDocument,
  parseOpdsFeed,
  resolveConnection,
} from "./calibre.ts";

/** Shape matches a real Calibre-Web /opds/new acquisition feed. */
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:uuid:2853dacf-ed79-42f5-8e8a-a7bb3d1ae6a2</id>
  <title>Recently added</title>
  <entry>
    <title>The Time Machine</title>
    <id>urn:uuid:0001</id>
    <author><name>H. G. Wells</name></author>
    <published>2026-07-01T09:30:00+00:00</published>
    <summary>&lt;p&gt;A Victorian scientist &amp;amp; inventor travels to the year 802,701.&lt;/p&gt;</summary>
    <link rel="http://opds-spec.org/image" href="/opds/cover/12" type="image/jpeg"/>
    <link rel="http://opds-spec.org/acquisition" href="/opds/download/12/epub/" type="application/epub+zip"/>
  </entry>
  <entry>
    <title>Frankenstein</title>
    <id>urn:uuid:0002</id>
    <author><name>Mary Shelley</name></author>
    <author><name>Percy Shelley</name></author>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>A scientist assembles a creature</p><p>and regrets it.</p></div></content>
    <link rel="http://opds-spec.org/image" href="/opds/cover/36" type="image/jpeg"/>
  </entry>
  <entry>
    <title>Placeholder Book</title>
    <id>urn:uuid:0004</id>
    <author><name>Nobody</name></author>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>无简介</p></div></content>
    <link rel="http://opds-spec.org/image" href="/opds/cover/44" type="image/jpeg"/>
  </entry>
  <entry>
    <title>No Cover Book</title>
    <id>urn:uuid:0003</id>
    <author><name>Nobody</name></author>
  </entry>
</feed>`;

describe("parseOpdsFeed", () => {
  it("extracts id, title, authors, summary, and published date", () => {
    const books = parseOpdsFeed(FEED);
    expect(books).toEqual([
      {
        id: 12,
        title: "The Time Machine",
        author: "H. G. Wells",
        summary: "A Victorian scientist & inventor travels to the year 802,701.",
        published: "2026-07-01T09:30:00+00:00",
      },
      {
        id: 36,
        title: "Frankenstein",
        author: "Mary Shelley, Percy Shelley",
        summary: "A scientist assembles a creature and regrets it.",
      },
      // "无简介" is Calibre-Web's no-description placeholder — dropped.
      { id: 44, title: "Placeholder Book", author: "Nobody" },
    ]);
  });

  it("handles a single-entry feed (parser yields object, not array)", () => {
    const single = FEED.replace(
      /<entry>[\s\S]*<\/entry>/,
      `<entry><title>Solo</title><id>urn:uuid:1</id>
       <author><name>A</name></author>
       <link href="/opds/cover/7" rel="http://opds-spec.org/image"/></entry>`,
    );
    expect(parseOpdsFeed(single)).toEqual([
      { id: 7, title: "Solo", author: "A" },
    ]);
  });

  it("returns empty for an empty feed", () => {
    expect(
      parseOpdsFeed(`<?xml version="1.0"?><feed><title>Empty</title></feed>`),
    ).toEqual([]);
  });
});

describe("parseOpdsDocument", () => {
  it("accepts a real feed", () => {
    expect(parseOpdsDocument(FEED).valid).toBe(true);
  });

  it("rejects an HTML login page served with HTTP 200", () => {
    const html = `<!DOCTYPE html><html><body><form action="/login">…</form></body></html>`;
    expect(parseOpdsDocument(html).valid).toBe(false);
  });

  it("accepts a valid but empty feed", () => {
    const result = parseOpdsDocument(
      `<?xml version="1.0"?><feed><title>Empty</title></feed>`,
    );
    expect(result.valid).toBe(true);
    expect(result.books).toEqual([]);
  });
});

describe("baseUrlCandidates", () => {
  it("strips login paths and query strings from address-bar pastes", () => {
    expect(baseUrlCandidates("https://book.example.com/login?next=%2F")).toEqual(
      ["https://book.example.com"],
    );
  });

  it("strips a pasted /opds path", () => {
    expect(baseUrlCandidates("https://book.example.com/opds/new")).toEqual([
      "https://book.example.com",
    ]);
  });

  it("keeps sub-path mounts, with the origin as fallback", () => {
    expect(baseUrlCandidates("https://nas.lan/calibre/")).toEqual([
      "https://nas.lan/calibre",
      "https://nas.lan",
    ]);
  });

  it("returns empty for garbage", () => {
    expect(baseUrlCandidates("not a url")).toEqual([]);
  });
});

describe("authHeaders", () => {
  it("builds basic auth from the connection", () => {
    expect(authHeaders({ user: "kyle", password: "secret" })).toEqual({
      Authorization: `Basic ${Buffer.from("kyle:secret").toString("base64")}`,
    });
    expect(authHeaders({ user: "", password: "" })).toEqual({});
  });
});

describe("connection resolution and shelf fetching", () => {
  const savedEnv = { ...process.env };
  let dir: string;
  const server = createServer((req, res) => {
    if (req.headers.authorization !== `Basic ${Buffer.from("kyle:pw").toString("base64")}`) {
      res.statusCode = 401;
      return res.end("Unauthorized Access");
    }
    res.setHeader("Content-Type", "application/atom+xml");
    res.end(FEED);
  });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "rackio-conn-"));
    initCalibre(createConnectionStore(dir));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
  afterAll(async () => {
    server.close();
    process.env = savedEnv;
    await rm(dir, { recursive: true, force: true });
  });
  afterEach(() => {
    clearCalibreCache();
    delete process.env.CALIBRE_BASE_URL;
    delete process.env.CALIBRE_USER;
    delete process.env.CALIBRE_PASSWORD;
  });

  function baseUrl(): string {
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  it("reports unconfigured with no env and no saved connection", async () => {
    expect(await getShelf("new")).toEqual({ configured: false });
  });

  it("persists a UI-saved connection with 0600 perms and round-trips it", async () => {
    const conn = { baseUrl: baseUrl(), user: "kyle", password: "pw" };
    const store = createConnectionStore(dir);
    await store.saveCalibre(conn);
    const mode = (await stat(join(dir, "connections.json"))).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(await resolveConnection()).toEqual({ ...conn, source: "saved" });

    const shelf = await getShelf("new");
    expect(shelf.error).toBeUndefined();
    expect(shelf.books?.[0].title).toBe("The Time Machine");

    await store.clearCalibre();
    expect(await resolveConnection()).toBeNull();
  });

  it("lets env vars override a saved connection", async () => {
    const store = createConnectionStore(dir);
    await store.saveCalibre({ baseUrl: "http://saved", user: "a", password: "b" });
    process.env.CALIBRE_BASE_URL = "http://from-env/";
    const resolved = await resolveConnection();
    expect(resolved?.source).toBe("env");
    expect(resolved?.baseUrl).toBe("http://from-env");
    await store.clearCalibre();
  });

  it("fetchShelf reports unauthorized on bad credentials", async () => {
    const shelf = await fetchShelf(
      { baseUrl: baseUrl(), user: "kyle", password: "wrong" },
      "new",
    );
    expect(shelf.error).toBe("unauthorized");
  });

  it("fetchShelf reports unreachable for a dead host", async () => {
    const shelf = await fetchShelf(
      { baseUrl: "http://127.0.0.1:1", user: "", password: "" },
      "new",
    );
    expect(shelf.error).toBe("unreachable");
  });
});

describe("fetchCover", () => {
  let dir: string;
  let hits = 0;
  let live = 0;
  let maxLive = 0;
  const server = createServer(async (req, res) => {
    hits += 1;
    live += 1;
    maxLive = Math.max(maxLive, live);
    await new Promise((resolve) => setTimeout(resolve, 30));
    live -= 1;
    res.setHeader("Content-Type", "image/jpeg");
    res.end(Buffer.from(`jpeg-bytes-${req.url}`));
  });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "rackio-cover-"));
    const store = createConnectionStore(dir);
    initCalibre(store, dir);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    await store.saveCalibre({
      baseUrl: `http://127.0.0.1:${port}`,
      user: "",
      password: "",
    });
  });
  afterAll(async () => {
    server.close();
    clearCoverCache();
    await rm(dir, { recursive: true, force: true });
  });

  it("caches covers and dedupes concurrent requests for the same id", async () => {
    hits = 0;
    const [a, b] = await Promise.all([fetchCover(1), fetchCover(1)]);
    expect(a).not.toBeNull();
    expect(Buffer.from(a!.body).equals(Buffer.from(b!.body))).toBe(true);
    expect(hits).toBe(1); // concurrent requests shared one download
    await fetchCover(1);
    expect(hits).toBe(1); // cached afterwards
  });

  it("limits concurrent upstream downloads to three", async () => {
    hits = 0;
    maxLive = 0;
    const results = await Promise.all(
      [10, 11, 12, 13, 14, 15, 16, 17].map((id) => fetchCover(id)),
    );
    expect(results.every(Boolean)).toBe(true);
    expect(hits).toBe(8);
    expect(maxLive).toBeLessThanOrEqual(3);
  });

  it("serves covers from disk after a restart (memory cache cleared)", async () => {
    await fetchCover(21);
    hits = 0;
    clearCoverCache(); // simulates a server restart losing the memory cache
    const cover = await fetchCover(21);
    expect(cover).not.toBeNull();
    expect(hits).toBe(0); // came from DATA_DIR/covers, not upstream
  });
});
