import { z } from "zod";
import type { BoardState } from "./types.ts";
import { BOARD_COLS_MAX } from "./types.ts";

/** Zod validation for persisted board state — used by both the SPA (cache
 *  parsing) and the server (PUT /api/board validation, board.json reads). */

export const cardInstanceSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  footprint: z.enum(["small", "big", "wide"]),
  // Columns scale with the viewport, so x is bounded by the widest
  // board we allow rather than the 12-column minimum.
  x: z.number().int().min(0).max(BOARD_COLS_MAX - 1),
  y: z.number().int().min(0),
  config: z.record(z.string(), z.unknown()),
});

export const boardStateSchema = z.object({
  version: z.literal(1),
  cards: z.array(cardInstanceSchema),
  updatedAt: z.number().optional(),
});

/** Validate an unknown value as BoardState; null if invalid. */
export function validateBoardState(value: unknown): BoardState | null {
  const parsed = boardStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
