import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (err) => errors.push(err.message));
await page.goto(process.env.BASE_URL || "http://127.0.0.1:5173");
await page.getByRole("heading", { name: "Operations overview" }).waitFor();
await page.waitForFunction(() =>
  document.body.textContent.includes("Live connection"),
);
await page.waitForFunction(
  () => !document.body.textContent.includes("Awaiting first reading"),
);
await page.waitForTimeout(5500);
await mkdir("docs/screenshots", { recursive: true });
await page.screenshot({
  path: "docs/screenshots/overview-desktop.png",
  fullPage: true,
});
console.log(
  JSON.stringify({
    title: await page.title(),
    errors,
    body: (await page.locator("body").innerText()).slice(0, 3500),
  }),
);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await page.screenshot({
  path: "docs/screenshots/overview-mobile.png",
  fullPage: true,
});
console.log(
  JSON.stringify({
    mobileOverflow: await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  }),
);
await page.setViewportSize({ width: 1440, height: 1000 });
await page.getByRole("button", { name: "Pipeline Health", exact: true }).click();
await page.waitForFunction(() => [...document.querySelectorAll(".diagnostics > div")].some(el => el.textContent.includes("Source → browser receipt") && !el.textContent.includes("—")));
await page.screenshot({path: "docs/screenshots/pipeline-health.png", fullPage: true});
console.log(JSON.stringify({pipelineDiagnostics: await page.locator(".diagnostics").innerText(),errors}));
await browser.close();
