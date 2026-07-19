import { z } from "zod";
import type { BoardState, CardInstance, Footprint } from "@shared/types";
import { FOOTPRINT_SPANS } from "@shared/types";
import { getCardDefinition } from "@/cards/registry";

export const BOARD_STORAGE_KEY = "rackio-board";

const cardInstanceSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  footprint: z.enum(["small", "big", "wide"]),
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
  config: z.record(z.string(), z.unknown()),
});

const boardStateSchema = z.object({
  version: z.literal(1),
  cards: z.array(cardInstanceSchema),
});

export function defaultBoard(): BoardState {
  return {
    version: 1,
    cards: [
      {
        id: "clock-default",
        type: "clock",
        footprint: "wide",
        x: 0,
        y: 0,
        config: { label: "Home rack", use24h: true, showSeconds: false },
      },
      {
        id: "utility-rack-health",
        type: "utility",
        footprint: "wide",
        x: 4,
        y: 0,
        config: {
          title: "Rack health",
          state: "Ready to connect",
          caption:
            "Add your first monitoring service to surface health signals here.",
        },
      },
      {
        id: "utility-storage",
        type: "utility",
        footprint: "small",
        x: 8,
        y: 0,
        config: {
          title: "Storage",
          state: "No source yet",
          caption: "Storage cards inherit the same three footprints.",
        },
      },
    ],
  };
}

/** Parse persisted board JSON; unknown card types are dropped, garbage → null. */
export function parseBoardState(raw: string | null): BoardState | null {
  if (!raw) return null;
  try {
    const parsed = boardStateSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return {
      version: 1,
      cards: parsed.data.cards.filter((card) =>
        Boolean(getCardDefinition(card.type)),
      ),
    };
  } catch {
    return null;
  }
}

export type BoardAction =
  | { kind: "add"; card: CardInstance }
  | { kind: "remove"; id: string }
  | { kind: "set-footprint"; id: string; footprint: Footprint }
  | { kind: "set-positions"; positions: ReadonlyArray<{ id: string; x: number; y: number }> }
  | { kind: "set-config"; id: string; config: Record<string, unknown> };

export function boardReducer(
  state: BoardState,
  action: BoardAction,
): BoardState {
  switch (action.kind) {
    case "add":
      return { ...state, cards: [...state.cards, action.card] };
    case "remove":
      return {
        ...state,
        cards: state.cards.filter((card) => card.id !== action.id),
      };
    case "set-footprint":
      return {
        ...state,
        cards: state.cards.map((card) =>
          card.id === action.id
            ? { ...card, footprint: action.footprint }
            : card,
        ),
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
      return changed ? { ...state, cards } : state;
    }
    case "set-config":
      return {
        ...state,
        cards: state.cards.map((card) =>
          card.id === action.id ? { ...card, config: action.config } : card,
        ),
      };
  }
}

/** Row below the lowest card — where newly added cards start before compaction. */
export function nextFreeRow(state: BoardState): number {
  return state.cards.reduce(
    (bottom, card) =>
      Math.max(bottom, card.y + FOOTPRINT_SPANS[card.footprint].h),
    0,
  );
}
