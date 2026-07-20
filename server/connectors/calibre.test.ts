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
  clearCalibreCache,
  fetchShelf,
  getShelf,
  initCalibre,
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
    <link rel="http://opds-spec.org/image" href="/opds/cover/12" type="image/jpeg"/>
    <link rel="http://opds-spec.org/acquisition" href="/opds/download/12/epub/" type="application/epub+zip"/>
  </entry>
  <entry>
    <title>Frankenstein</title>
    <id>urn:uuid:0002</id>
    <author><name>Mary Shelley</name></author>
    <author><name>Percy Shelley</name></author>
    <link rel="http://opds-spec.org/image" href="/opds/cover/36" type="image/jpeg"/>
  </entry>
  <entry>
    <title>No Cover Book</title>
    <id>urn:uuid:0003</id>
    <author><name>Nobody</name></author>
  </entry>
</feed>`;

describe("parseOpdsFeed", () => {
  it("extracts id, title, and authors from a Calibre-Web feed", () => {
    const books = parseOpdsFeed(FEED);
    expect(books).toEqual([
      { id: 12, title: "The Time Machine", author: "H. G. Wells" },
      { id: 36, title: "Frankenstein", author: "Mary Shelley, Percy Shelley" },
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
