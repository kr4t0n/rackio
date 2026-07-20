// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BoardState } from "../shared/types.ts";
import { createBoardStore } from "./store.ts";

const board: BoardState = {
  version: 1,
  cards: [
    {
      id: "a",
      type: "clock",
      footprint: "wide",
      x: 0,
      y: 0,
      config: { label: "Test" },
    },
  ],
};

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "rackio-store-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("createBoardStore", () => {
  it("returns null when no board has been saved", async () => {
    const store = createBoardStore(join(dir, "empty"));
    expect(await store.load()).toBeNull();
  });

  it("round-trips a board through disk", async () => {
    const store = createBoardStore(dir);
    await store.save(board);
    expect(await store.load()).toEqual(board);
  });

  it("returns null for a corrupted file", async () => {
    const store = createBoardStore(dir);
    await writeFile(join(dir, "board.json"), "{nope", "utf8");
    expect(await store.load()).toBeNull();
  });

  it("serializes concurrent saves — last write wins, file stays valid", async () => {
    const store = createBoardStore(dir);
    const versions = Array.from({ length: 5 }, (_, i) => ({
      ...board,
      cards: [{ ...board.cards[0], y: i }],
    }));
    await Promise.all(versions.map((v) => store.save(v)));
    const raw = JSON.parse(await readFile(join(dir, "board.json"), "utf8"));
    expect(raw.cards[0].y).toBe(4);
  });
});
