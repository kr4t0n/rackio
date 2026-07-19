import { describe, expect, it } from "vitest";
import type { BoardState, CardInstance } from "@shared/types";
import {
  boardReducer,
  defaultBoard,
  nextFreeRow,
  parseBoardState,
} from "./state";

function makeCard(overrides: Partial<CardInstance> = {}): CardInstance {
  return {
    id: "card-1",
    type: "clock",
    footprint: "wide",
    x: 0,
    y: 0,
    config: { label: "Test", use24h: true, showSeconds: false },
    ...overrides,
  };
}

function makeBoard(cards: CardInstance[]): BoardState {
  return { version: 1, cards };
}

describe("boardReducer", () => {
  it("adds a card", () => {
    const next = boardReducer(makeBoard([]), {
      kind: "add",
      card: makeCard(),
    });
    expect(next.cards).toHaveLength(1);
    expect(next.cards[0].id).toBe("card-1");
  });

  it("removes a card", () => {
    const next = boardReducer(makeBoard([makeCard()]), {
      kind: "remove",
      id: "card-1",
    });
    expect(next.cards).toHaveLength(0);
  });

  it("changes a footprint", () => {
    const next = boardReducer(makeBoard([makeCard()]), {
      kind: "set-footprint",
      id: "card-1",
      footprint: "big",
    });
    expect(next.cards[0].footprint).toBe("big");
  });

  it("commits new positions", () => {
    const next = boardReducer(makeBoard([makeCard()]), {
      kind: "set-positions",
      positions: [{ id: "card-1", x: 4, y: 2 }],
    });
    expect(next.cards[0]).toMatchObject({ x: 4, y: 2 });
  });

  it("returns the same reference when positions are unchanged", () => {
    const state = makeBoard([makeCard({ x: 4, y: 2 })]);
    const next = boardReducer(state, {
      kind: "set-positions",
      positions: [{ id: "card-1", x: 4, y: 2 }],
    });
    expect(next).toBe(state);
  });

  it("updates card config", () => {
    const next = boardReducer(makeBoard([makeCard()]), {
      kind: "set-config",
      id: "card-1",
      config: { label: "Updated", use24h: false, showSeconds: true },
    });
    expect(next.cards[0].config.label).toBe("Updated");
  });
});

describe("parseBoardState", () => {
  it("returns null for garbage input", () => {
    expect(parseBoardState(null)).toBeNull();
    expect(parseBoardState("not json")).toBeNull();
    expect(parseBoardState('{"version":99}')).toBeNull();
  });

  it("round-trips a valid board", () => {
    const board = defaultBoard();
    const parsed = parseBoardState(JSON.stringify(board));
    expect(parsed).toEqual(board);
  });

  it("drops cards whose type is not registered", () => {
    const board = makeBoard([
      makeCard(),
      makeCard({ id: "card-2", type: "not-a-real-card" }),
    ]);
    const parsed = parseBoardState(JSON.stringify(board));
    expect(parsed?.cards.map((card) => card.id)).toEqual(["card-1"]);
  });
});

describe("nextFreeRow", () => {
  it("is 0 for an empty board", () => {
    expect(nextFreeRow(makeBoard([]))).toBe(0);
  });

  it("returns the row below the lowest card", () => {
    const board = makeBoard([
      makeCard({ y: 0, footprint: "wide" }), // bottom edge 2
      makeCard({ id: "card-2", y: 2, footprint: "big" }), // bottom edge 6
    ]);
    expect(nextFreeRow(board)).toBe(6);
  });
});
