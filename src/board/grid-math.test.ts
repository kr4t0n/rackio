import { describe, expect, it } from "vitest";
import { BOARD_COLS_MAX, BOARD_COLS_MIN } from "@shared/types";
import {
  computeCellSize,
  computeColumns,
  TARGET_CELL_SIZE,
} from "./grid-math";

describe("computeColumns", () => {
  it("never drops below the 12-column floor", () => {
    // A 4-wide card sits at x=8 in existing layouts — fewer columns would
    // push it out of the grid.
    expect(computeColumns(600)).toBe(BOARD_COLS_MIN);
    expect(computeColumns(1356)).toBe(BOARD_COLS_MIN);
    expect(computeColumns(0)).toBe(BOARD_COLS_MIN);
  });

  it("adds columns as the board widens, instead of growing cells", () => {
    const wide = computeColumns(3356); // ultrawide, minus board padding
    expect(wide).toBeGreaterThan(BOARD_COLS_MIN);
    // Cells stay near the reference density rather than ballooning.
    const cell = computeCellSize(3356, wide);
    expect(Math.abs(cell - TARGET_CELL_SIZE)).toBeLessThan(20);
  });

  it("is bounded so stored x stays within the schema", () => {
    expect(computeColumns(100_000)).toBe(BOARD_COLS_MAX);
  });
});

describe("computeCellSize", () => {
  it("matches the reference formula: (width − 11·gap) / 12", () => {
    expect(computeCellSize(1440)).toBeCloseTo((1440 - 11 * 16) / 12);
    expect(computeCellSize(1024)).toBeCloseTo((1024 - 11 * 16) / 12);
  });

  it("keeps footprints square: a 2×2 card is as tall as it is wide", () => {
    const cell = computeCellSize(1440);
    const cardWidth = 2 * cell + 16; // two columns + one gap
    const cardHeight = 2 * cell + 16; // two rows + one gap
    expect(cardWidth).toBeCloseTo(cardHeight);
  });

  it("never collapses below 1px", () => {
    expect(computeCellSize(0)).toBe(1);
    expect(computeCellSize(100)).toBeGreaterThan(0);
  });
});
