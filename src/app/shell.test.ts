import { describe, expect, it } from "vitest";
import { resolveShell } from "./shell";

describe("resolveShell", () => {
  it("defaults to the app shell", () => {
    expect(resolveShell("")).toBe("app");
    expect(resolveShell("?theme=light")).toBe("app");
  });

  it("recognises the wallpaper shell", () => {
    expect(resolveShell("?shell=wallpaper")).toBe("wallpaper");
    expect(resolveShell("?foo=1&shell=wallpaper")).toBe("wallpaper");
  });

  it("ignores any other shell value", () => {
    expect(resolveShell("?shell=desktop")).toBe("app");
    expect(resolveShell("?shell=")).toBe("app");
  });
});
