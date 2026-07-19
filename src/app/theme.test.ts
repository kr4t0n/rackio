import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, getStoredTheme, THEME_STORAGE_KEY } from "./theme";

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = "dark";
  });

  it("defaults to dark when nothing is stored", () => {
    expect(getStoredTheme()).toBe("dark");
  });

  it("defaults to dark when the stored value is invalid", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "solarized");
    expect(getStoredTheme()).toBe("dark");
  });

  it("applies and persists a theme", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(getStoredTheme()).toBe("light");

    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(getStoredTheme()).toBe("dark");
  });
});
