// @vitest-environment node
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  architecturesOf,
  clearDockerHubToken,
  fetchDockerHub,
  mapImage,
  normalizeNamespace,
  pickTag,
} from "./dockerhub.ts";

describe("normalizeNamespace", () => {
  it("accepts a bare handle", () => {
    expect(normalizeNamespace("  kr4t0n ")).toBe("kr4t0n");
    expect(normalizeNamespace("My-Org")).toBe("my-org");
  });

  it("pulls the namespace out of the URLs people paste", () => {
    expect(normalizeNamespace("https://hub.docker.com/u/kr4t0n")).toBe("kr4t0n");
    expect(normalizeNamespace("https://hub.docker.com/r/kr4t0n/rackio")).toBe("kr4t0n");
    expect(normalizeNamespace("https://hub.docker.com/repository/docker/kr4t0n/rackio")).toBe(
      "kr4t0n",
    );
  });

  it("rejects anything that isn't a handle", () => {
    expect(normalizeNamespace("")).toBeNull();
    expect(normalizeNamespace("has spaces")).toBeNull();
    expect(normalizeNamespace("-leading-dash")).toBeNull();
  });
});

describe("pickTag", () => {
  const tag = (name: string, last_updated: string) => ({ name, last_updated });

  it("prefers a real version over latest, even when latest is newer", () => {
    const picked = pickTag([
      tag("latest", "2026-07-26T10:00:00Z"),
      tag("1.8.0", "2026-07-26T09:00:00Z"),
    ]);
    expect(picked?.name).toBe("1.8.0");
  });

  it("takes the newest version when there are several", () => {
    const picked = pickTag([
      tag("v2.0.0-rc1", "2026-07-26T10:00:00Z"),
      tag("1.9.0", "2026-07-01T10:00:00Z"),
    ]);
    expect(picked?.name).toBe("v2.0.0-rc1");
  });

  it("falls back to latest for a CI-only repo", () => {
    // rackio's own tags: no semver, just latest/main/sha-*.
    const picked = pickTag([
      tag("sha-6bab111", "2026-07-26T15:25:35Z"),
      tag("latest", "2026-07-26T15:25:34Z"),
      tag("main", "2026-07-26T15:25:33Z"),
    ]);
    expect(picked?.name).toBe("latest");
  });

  it("falls back to the newest tag of any shape", () => {
    expect(pickTag([tag("edge", "2026-01-01T00:00:00Z")])?.name).toBe("edge");
    expect(pickTag([])).toBeNull();
  });
});

describe("architecturesOf", () => {
  it("drops buildx attestation manifests and dedupes", () => {
    expect(
      architecturesOf({
        images: [
          { architecture: "amd64" },
          { architecture: "arm64" },
          { architecture: "unknown" },
          { architecture: "amd64" },
        ],
      }),
    ).toEqual(["amd64", "arm64"]);
  });
});

describe("mapImage", () => {
  const image = mapImage(
    {
      name: "rackio",
      description: "  Dashboard for the rack  ",
      is_private: false,
      last_updated: "2026-07-01T00:00:00Z",
    },
    {
      name: "1.8.0",
      digest: "sha256:abcd",
      full_size: 74_875_890,
      last_updated: "2026-07-26T15:25:35Z",
      images: [{ architecture: "amd64" }],
    },
    "kr4t0n",
  );

  it("builds the name, pull command and Hub link", () => {
    expect(image.name).toBe("kr4t0n/rackio");
    expect(image.pullCommand).toBe("docker pull kr4t0n/rackio:1.8.0");
    expect(image.webUrl).toBe("https://hub.docker.com/r/kr4t0n/rackio");
  });

  it("prefers the tag's timestamp over the repository's and trims the blurb", () => {
    expect(image.updatedAt).toBe("2026-07-26T15:25:35Z");
    expect(image.description).toBe("Dashboard for the rack");
  });
});

describe("fetchDockerHub", () => {
  let seenAuth: string | undefined;
  let repoStatus = 200;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    res.setHeader("Content-Type", "application/json");

    if (url.pathname === "/v2/users/login/") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const { password } = JSON.parse(body || "{}");
        if (password !== "good-token") {
          res.statusCode = 401;
          return res.end(JSON.stringify({ detail: "nope" }));
        }
        res.end(JSON.stringify({ token: "jwt-123" }));
      });
      return;
    }

    seenAuth = req.headers.authorization;

    if (url.pathname === "/v2/repositories/acme/") {
      if (repoStatus !== 200) {
        res.statusCode = repoStatus;
        return res.end(JSON.stringify({ detail: "no" }));
      }
      return res.end(
        JSON.stringify({
          results: [
            { name: "old", is_private: false, last_updated: "2026-01-01T00:00:00Z" },
            { name: "fresh", is_private: true, last_updated: "2026-07-01T00:00:00Z" },
            { name: "tagless", is_private: false, last_updated: "2026-06-01T00:00:00Z" },
          ],
        }),
      );
    }
    if (url.pathname === "/v2/repositories/acme/tagless/tags/") {
      return res.end(JSON.stringify({ results: [] }));
    }
    if (url.pathname.startsWith("/v2/repositories/acme/")) {
      const repo = url.pathname.split("/")[4];
      return res.end(
        JSON.stringify({
          results: [
            {
              name: `${repo}-1.0.0`,
              digest: "sha256:dead",
              full_size: 1024,
              last_updated: "2026-07-02T00:00:00Z",
              images: [{ architecture: "amd64" }],
            },
          ],
        }),
      );
    }
    res.statusCode = 404;
    res.end("{}");
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
  afterAll(() => server.close());
  beforeEach(() => {
    clearDockerHubToken();
    seenAuth = undefined;
    repoStatus = 200;
  });

  const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  it("reads a namespace anonymously, newest repository first", async () => {
    const state = await fetchDockerHub({ namespace: "acme" }, base());
    expect(state.error).toBeUndefined();
    expect(state.authenticated).toBe(false);
    expect(seenAuth).toBeUndefined();
    expect(state.images?.map((image) => image.name)).toEqual([
      "acme/fresh",
      "acme/old",
    ]);
  });

  it("drops a repository with no tags rather than showing it half-empty", async () => {
    const state = await fetchDockerHub({ namespace: "acme" }, base());
    expect(state.images?.some((image) => image.repo === "tagless")).toBe(false);
  });

  it("signs in when credentials are given and carries the JWT", async () => {
    const state = await fetchDockerHub(
      { namespace: "acme", username: "me", token: "good-token" },
      base(),
    );
    expect(state.authenticated).toBe(true);
    expect(seenAuth).toBe("JWT jwt-123");
    expect(state.images?.[0].isPrivate).toBe(true);
  });

  it("reports rejected credentials without falling back to anonymous", async () => {
    const state = await fetchDockerHub(
      { namespace: "acme", username: "me", token: "wrong" },
      base(),
    );
    expect(state.error).toBe("unauthorized");
    expect(state.images).toBeUndefined();
  });

  it("distinguishes a missing namespace from a broken registry", async () => {
    repoStatus = 404;
    expect((await fetchDockerHub({ namespace: "acme" }, base())).error).toBe("not-found");
    repoStatus = 500;
    expect((await fetchDockerHub({ namespace: "acme" }, base())).error).toBe("unreachable");
    expect(
      (await fetchDockerHub({ namespace: "acme" }, "http://127.0.0.1:1")).error,
    ).toBe("unreachable");
  });
});
