import type { BoardState, CardInstance, Footprint } from "@shared/types";
import { FOOTPRINT_SPANS } from "@shared/types";
import { validateBoardState } from "@shared/board-schema";
import { getCardDefinition } from "@/cards/registry";

export const BOARD_STORAGE_KEY = "rackio-board";

/**
 * The board a brand-new install starts with. Deliberately only cards that
 * are live with zero configuration — the rest are one click away in the
 * catalog, and an opening screen full of "not connected" states would sell
 * the board short.
 */
export function defaultBoard(): BoardState {
  return {
    version: 1,
    cards: [
      {
        id: "time-default",
        type: "clock",
        footprint: "wide",
        x: 0,
        y: 0,
        config: {
          hour12: false,
          zones: ["UTC", "America/New_York", "Europe/London", "Asia/Tokyo"],
        },
      },
      {
        id: "weather-default",
        type: "weather",
        footprint: "wide",
        x: 4,
        y: 0,
        config: { locationName: "London", lat: 51.5072, lon: -0.1276 },
      },
    ],
  };
}

/** Validate a board value; unknown card types are dropped, garbage → null. */
export function sanitizeBoardState(value: unknown): BoardState | null {
  const board = validateBoardState(value);
  if (!board) return null;
  return {
    version: 1,
    cards: board.cards.filter((card) => Boolean(getCardDefinition(card.type))),
  };
}

/** Parse persisted board JSON (localStorage cache). */
export function parseBoardState(raw: string | null): BoardState | null {
  if (!raw) return null;
  try {
    return sanitizeBoardState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export type BoardAction =
  | { kind: "replace"; board: BoardState }
  | { kind: "add"; card: CardInstance }
  | { kind: "remove"; id: string }
  | { kind: "set-footprint"; id: string; footprint: Footprint }
  | { kind: "set-positions"; positions: ReadonlyArray<{ id: string; x: number; y: number }> }
  | { kind: "set-config"; id: string; config: Record<string, unknown> };

export function boardReducer(
  state: BoardState,
  action: BoardAction,
): BoardState {
  // Every mutation stamps updatedAt so hydration can pick the newer of the
  // local cache and the server copy (see useBoardState).
  const stamp = () => Date.now();
  switch (action.kind) {
    case "replace":
      return action.board;
    case "add":
      return {
        ...state,
        cards: [...state.cards, action.card],
        updatedAt: stamp(),
      };
    case "remove":
      return {
        ...state,
        cards: state.cards.filter((card) => card.id !== action.id),
        updatedAt: stamp(),
      };
    case "set-footprint":
      return {
        ...state,
        cards: state.cards.map((card) =>
          card.id === action.id
            ? { ...card, footprint: action.footprint }
            : card,
        ),
        updatedAt: stamp(),
      };
    case "set-positions": {
      const byId = new Map(action.positions.map((p) => [p.id, p]));
      let changed = false;
      const cards = state.cards.map((card) => {
        const next = byId.get(card.id);
        if (!next || (next.x === card.x && next.y === card.y)) return card;
        changed = true;
        return { ...card, x: next.x, y: next.y };
      });
      // Referential stability matters: grid onLayoutChange fires after every
      // commit, and returning the same state object breaks the update loop.
      return changed ? { ...state, cards, updatedAt: stamp() } : state;
    }
    case "set-config":
      return {
        ...state,
        cards: state.cards.map((card) =>
          card.id === action.id ? { ...card, config: action.config } : card,
        ),
        updatedAt: stamp(),
      };
  }
}

/**
 * Card instance IDs. crypto.randomUUID only exists in secure contexts, and
 * rackio is typically served over plain HTTP on a LAN/tailnet IP — so fall
 * back to a timestamp+random ID (uniqueness only needs to be board-local).
 */
export function generateCardId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  const random = Math.random().toString(36).slice(2, 10);
  return `card-${Date.now().toString(36)}-${random}`;
}

/** Row below the lowest card — where newly added cards start before compaction. */
export function nextFreeRow(state: BoardState): number {
  return state.cards.reduce(
    (bottom, card) =>
      Math.max(bottom, card.y + FOOTPRINT_SPANS[card.footprint].h),
    0,
  );
}
