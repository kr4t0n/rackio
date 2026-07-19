export const BOARD_COLS = 12;
export const BOARD_GAP = 16;

/**
 * Square-cell size for the 12-column board. The row height must track the
 * column width exactly or footprints stop being square (reference formula:
 * (width − 11·gap) / 12).
 */
export function computeCellSize(
  containerWidth: number,
  cols: number = BOARD_COLS,
  gap: number = BOARD_GAP,
): number {
  return Math.max(1, (containerWidth - gap * (cols - 1)) / cols);
}
