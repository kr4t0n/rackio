import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:8791";
// CHROMIUM_PATH lets us reuse an already-cached browser build when the
// playwright-pinned revision isn't downloaded on this machine.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});

async function shot(name, { viewport, theme, search = "", transparent = false }) {
  const context = await browser.newContext({ viewport });
  if (theme) {
    await context.addInitScript((t) => localStorage.setItem("rackio-theme", t), theme);
  }
  const page = await context.newPage();
  await page.goto(base + search, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  // omitBackground keeps the alpha channel, so the wallpaper shot shows what
  // the macOS app's transparent WKWebView actually composites.
  await page.screenshot({ path: `/tmp/rackio-${name}.png`, omitBackground: transparent });
  await context.close();
  console.log(`saved /tmp/rackio-${name}.png`);
}

await shot("dark", { viewport: { width: 1440, height: 900 } });
await shot("light", { viewport: { width: 1440, height: 900 }, theme: "light" });
await shot("mobile", { viewport: { width: 390, height: 844 } });
await shot("wallpaper", {
  viewport: { width: 1440, height: 900 },
  search: "/?shell=wallpaper",
  transparent: true,
});
await browser.close();
