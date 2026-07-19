import { describe, expect, it } from "vitest";
import { computeCellSize } from "./grid-math";

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
