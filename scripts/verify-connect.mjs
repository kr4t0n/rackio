// One-off: drive the calibre connect-from-settings flow end to end.
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:8791";
const failures = [];
function check(name, cond) {
  console.log(`${cond ? "  ok" : "  FAIL"}: ${name}`);
  if (!cond) failures.push(name);
}

// Reset any saved connection, then seed one calibre card.
await fetch(`${base}/api/calibre/connection`, { method: "DELETE" });
await fetch(`${base}/api/board`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    version: 1,
    updatedAt: 4102444800000,
    cards: [
      { id: "c1", type: "calibre", footprint: "big", x: 4, y: 0, config: { source: "new" } },
    ],
  }),
});

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("rackio-board"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(500);

check("card shows Not connected", await page.getByText("Not connected").isVisible());

// Open settings, try wrong credentials.
await page.getByRole("button", { name: "Edit board" }).click();
await page.getByRole("button", { name: "Open Calibre library settings" }).click();
await page.waitForTimeout(700);
await page.getByLabel("Server URL").fill("http://localhost:8093");
await page.getByLabel("Username").fill("kyle");
await page.getByLabel("Password").fill("wrongpw");
await page.getByRole("button", { name: "Connect" }).click();
await page.waitForTimeout(1000);
check(
  "wrong password is rejected inline",
  await page.getByText("rejected those credentials").isVisible(),
);

// Correct credentials.
await page.getByLabel("Password").fill("goodpw");
await page.getByRole("button", { name: "Connect" }).click();
await page.waitForTimeout(1200);
check(
  "connect succeeds and panel shows connected summary",
  await page.getByText(/Connected to http:\/\/localhost:8093/).isVisible(),
);
await page.screenshot({ path: "/tmp/rackio-m4-connected-panel.png" });

// Close settings; the card should now show books.
await page.getByRole("button", { name: "Cancel" }).click();
await page.waitForTimeout(1500);
check(
  "card shows the shelf after connecting",
  await page.getByText("The Time Machine").isVisible(),
);

// Survives reload (server-side persistence).
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1500);
check(
  "connection survives reload",
  await page.getByText("The Time Machine").isVisible(),
);
await page.screenshot({ path: "/tmp/rackio-m4-connected-card.png" });

await browser.close();
if (failures.length) {
  console.error(`${failures.length} failure(s)`);
  process.exit(1);
}
console.log("connect flow verified");
