import { BOARD_COLS_MAX, BOARD_COLS_MIN } from "@shared/types";

export const BOARD_COLS = BOARD_COLS_MIN;
export const BOARD_GAP = 16;

/**
 * Cell size the board aims for, in px. Taken from the reference design:
 * 12 columns across a 1440px board ≈ 105px cells (a 2×2 card ≈ 226px).
 * Columns are chosen to keep cells near this size, so a wider screen holds
 * MORE cards rather than bigger ones.
 */
export const TARGET_CELL_SIZE = 108;

/**
 * How many columns fit the container while keeping cells near the target.
 * Never fewer than BOARD_COLS_MIN: existing layouts place 4-wide cards at
 * x=8, which needs 12 columns to render at all.
 */
export function computeColumns(
  containerWidth: number,
  gap: number = BOARD_GAP,
): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return BOARD_COLS_MIN;
  }
  const fitted = Math.floor((containerWidth + gap) / (TARGET_CELL_SIZE + gap));
  return Math.min(BOARD_COLS_MAX, Math.max(BOARD_COLS_MIN, fitted));
}

/**
 * Square-cell size for the board. The row height must track the column
 * width exactly or footprints stop being square (reference formula:
 * (width − (cols−1)·gap) / cols).
 */
export function computeCellSize(
  containerWidth: number,
  cols: number = BOARD_COLS,
  gap: number = BOARD_GAP,
): number {
  return Math.max(1, (containerWidth - gap * (cols - 1)) / cols);
}
