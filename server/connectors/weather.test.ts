// @vitest-environment node
import { describe, expect, it } from "vitest";
import { interpretWmoCode } from "./weather.ts";

describe("interpretWmoCode", () => {
  it("maps the WMO code groups onto the four scene families", () => {
    expect(interpretWmoCode(0).sceneMode).toBe("clear");
    expect(interpretWmoCode(1).sceneMode).toBe("clear");
    expect(interpretWmoCode(2).sceneMode).toBe("cloudy");
    expect(interpretWmoCode(3).sceneMode).toBe("cloudy");
    expect(interpretWmoCode(45).sceneMode).toBe("cloudy");
    expect(interpretWmoCode(55).sceneMode).toBe("rain");
    expect(interpretWmoCode(63).sceneMode).toBe("rain");
    expect(interpretWmoCode(81).sceneMode).toBe("rain");
    expect(interpretWmoCode(73).sceneMode).toBe("snow");
    expect(interpretWmoCode(86).sceneMode).toBe("snow");
    expect(interpretWmoCode(95).sceneMode).toBe("storm");
    expect(interpretWmoCode(99).sceneMode).toBe("storm");
  });

  it("falls back to cloudy for unknown codes", () => {
    expect(interpretWmoCode(42).sceneMode).toBe("cloudy");
  });

  it("gives every code a human condition string", () => {
    for (const code of [0, 2, 45, 53, 65, 75, 82, 85, 96]) {
      expect(interpretWmoCode(code).condition.length).toBeGreaterThan(2);
    }
  });
});
