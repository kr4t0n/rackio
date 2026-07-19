import { describe, expect, it } from "vitest";
import { FOOTPRINT_SPANS } from "./types.ts";

describe("FOOTPRINT_SPANS", () => {
  it("keeps every footprint within the 12-column grid", () => {
    for (const { w, h } of Object.values(FOOTPRINT_SPANS)) {
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(12);
      expect(h).toBeGreaterThan(0);
    }
  });

  it("matches the reference design footprints", () => {
    expect(FOOTPRINT_SPANS.small).toEqual({ w: 2, h: 2 });
    expect(FOOTPRINT_SPANS.big).toEqual({ w: 4, h: 4 });
    expect(FOOTPRINT_SPANS.wide).toEqual({ w: 4, h: 2 });
  });
});
