/**
 * Headless smoke test for the board engine: edit mode, drag, footprint
 * switching, settings, catalog add/remove, and persistence across reload.
 * Run with a rackio instance serving (BASE_URL, default :8791).
 */
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:8791";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const failures = [];

function check(name, condition) {
  if (condition) console.log(`  ok: ${name}`);
  else {
    failures.push(name);
    console.error(`  FAIL: ${name}`);
  }
}

// Deterministic start: reset client cache and server board to the fixture.
const FIXTURE = {
  version: 1,
  cards: [
    { id: "clock-default", type: "clock", footprint: "wide", x: 0, y: 0,
      config: { label: "Home rack", use24h: true, showSeconds: false } },
    { id: "utility-rack-health", type: "utility", footprint: "wide", x: 4, y: 0,
      config: { title: "Rack health", state: "Ready to connect", caption: "…" } },
    { id: "utility-storage", type: "utility", footprint: "small", x: 8, y: 0,
      config: { title: "Storage", state: "No source yet", caption: "…" } },
  ],
};
await page.goto(base, { waitUntil: "networkidle" });
await page.evaluate(async (fixture) => {
  localStorage.clear();
  await fetch("/api/board", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fixture),
  });
}, FIXTURE);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(300);

// Default board renders three cards.
const cardCount = await page.locator(".card-frame").count();
check("default board has 3 cards", cardCount === 3);
await page.screenshot({ path: "/tmp/rackio-m1-view.png" });

// Edit mode reveals affordances.
await page.getByRole("button", { name: "Edit board" }).click();
await page.waitForTimeout(350); // let transitions settle before the screenshot
check(
  "edit mode shows drag handles",
  (await page.locator(".card-drag-handle").count()) === 3,
);
await page.screenshot({ path: "/tmp/rackio-m1-edit.png" });

// Drag the clock card by its handle to the right.
const clockBefore = await page
  .locator('[data-card-type="clock"]')
  .boundingBox();
const handle = page
  .locator('[data-card-type="clock"] .card-drag-handle')
  .first();
const handleBox = await handle.boundingBox();
await page.mouse.move(
  handleBox.x + handleBox.width / 2,
  handleBox.y + handleBox.height / 2,
);
await page.mouse.down();
await page.mouse.move(handleBox.x + 500, handleBox.y + 320, { steps: 20 });
await page.waitForTimeout(150);
await page.screenshot({ path: "/tmp/rackio-m1-dragging.png" });
await page.mouse.up();
await page.waitForTimeout(400);
const clockAfter = await page.locator('[data-card-type="clock"]').boundingBox();
check(
  "clock card moved after drag",
  Math.abs(clockAfter.x - clockBefore.x) > 50 ||
    Math.abs(clockAfter.y - clockBefore.y) > 50,
);

// Footprint switch: storage card small → big.
const storage = page.locator('[data-footprint="small"]').first();
const smallBox = await storage.boundingBox();
await storage.getByRole("button", { name: "big footprint" }).click();
await page.waitForTimeout(400);
const bigBox = await page
  .locator('[data-card-type="utility"][data-footprint="big"]')
  .first()
  .boundingBox();
check(
  "footprint switch small→big roughly doubles size",
  bigBox && bigBox.width > smallBox.width * 1.8,
);

// Settings: open clock settings, rename, save.
await page
  .getByRole("button", { name: "Open Clock settings" })
  .click();
await page.waitForTimeout(700);
await page.screenshot({ path: "/tmp/rackio-m1-settings.png" });
const labelInput = page.getByLabel("Label");
await labelInput.fill("Kyle's rack");
await page.getByRole("button", { name: "Save" }).click();
await page.waitForTimeout(500);
check(
  "settings save updates the card",
  await page.getByText("Kyle's rack").isVisible(),
);

// Catalog: add a clock card.
await page.getByRole("button", { name: "Add card" }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/rackio-m1-catalog.png" });
await page.getByRole("button", { name: "Add Clock card" }).click();
await page.waitForTimeout(300);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check(
  "catalog add creates a 4th card",
  (await page.locator(".card-frame").count()) === 4,
);

// Remove it again.
await page
  .locator('[data-card-type="clock"]')
  .nth(1)
  .getByRole("button", { name: /Remove/ })
  .click();
await page.waitForTimeout(300);
check(
  "remove deletes the card",
  (await page.locator(".card-frame").count()) === 3,
);

// Persistence: reload and compare the stored grid state (absolute pixel
// positions shift with the header height, which differs between edit/view).
const storedBefore = await page.evaluate(() =>
  localStorage.getItem("rackio-board"),
);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(400);
const storedAfter = await page.evaluate(() =>
  localStorage.getItem("rackio-board"),
);
check("layout survives reload", storedBefore === storedAfter);
if (storedBefore !== storedAfter) {
  console.error("  before:", storedBefore);
  console.error("  after: ", storedAfter);
}
check(
  "config survives reload",
  await page.getByText("Kyle's rack").isVisible(),
);

// Server persistence: the board must land in /api/board (debounced save).
await page.waitForTimeout(900);
const serverBoard = await page.evaluate(async () => {
  const res = await fetch("/api/board");
  return JSON.stringify(await res.json());
});
check(
  "board persisted to the server",
  serverBoard.includes("Kyle's rack"),
);
await page.screenshot({ path: "/tmp/rackio-m1-final.png" });

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nAll board smoke checks passed.");
