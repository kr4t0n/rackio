/**
 * Types shared between the SPA and the server. The board only ever deals in
 * these shapes — card internals stay inside each card module.
 */

export type Footprint = "small" | "big" | "wide";

/**
 * The board grows columns with the viewport rather than stretching cards:
 * a wider screen holds MORE cards at the same size. 12 is the floor (the
 * reference design's column count, and the minimum that fits a 4-wide card
 * at x=8); the ceiling just bounds stored positions.
 */
export const BOARD_COLS_MIN = 12;
export const BOARD_COLS_MAX = 48;

/** Grid spans per footprint on the 12-column, square-cell board. */
export const FOOTPRINT_SPANS: Record<Footprint, { w: number; h: number }> = {
  small: { w: 2, h: 2 },
  big: { w: 4, h: 4 },
  wide: { w: 4, h: 2 },
};

export interface CardInstance {
  id: string;
  /** Card type key registered in the card registry, e.g. "weather". */
  type: string;
  footprint: Footprint;
  x: number;
  y: number;
  /** Card-type-specific config, validated by the card's zod schema. */
  config: Record<string, unknown>;
}

export interface BoardState {
  version: 1;
  cards: CardInstance[];
  /** Epoch ms of the last mutation — newer wins when cache and server disagree. */
  updatedAt?: number;
}

export const EMPTY_BOARD: BoardState = { version: 1, cards: [] };
