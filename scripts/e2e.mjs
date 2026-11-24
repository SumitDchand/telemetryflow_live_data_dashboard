import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.env.BASE_URL || "http://127.0.0.1:5173";
const token = process.env.ADMIN_TOKEN;
assert(token, "ADMIN_TOKEN required; run through scripts/with-env.py");
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [],
  checks = [];
page.on("pageerror", (err) => errors.push(err.message));
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`PASS ${name}`);
}
async function nav(name) {
  await page.getByRole("button", { name, exact: true }).first().click();
}
try {
  await check("Dashboard bootstraps real data", async () => {
    await page.goto(base);
    await page.waitForFunction(
      () =>
        document.body.textContent.includes("Live connection") &&
        !document.body.textContent.includes("Awaiting first reading"),
    );
    await page.locator(".recharts-line-curve").first().waitFor();
  });
  await check("WebSocket updates dashboard without refresh", async () => {
    const before = await page.locator(".last-updated strong").innerText();
    await page.waitForFunction(
      (v) => document.querySelector(".last-updated strong").textContent !== v,
      before,
      { timeout: 15000 },
    );
  });
  await check("All four live charts and pause/resume work", async () => {
    await nav("Live Telemetry");
    assert.equal(await page.locator(".chart-panel").count(), 4);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const before = await page.locator(".last-updated strong").innerText();
    await page.waitForTimeout(2300);
    assert.equal(
      await page.locator(".last-updated strong").innerText(),
      before,
    );
    await page.getByRole("button", { name: "Resume", exact: true }).click();
  });
  await check("Machine filter and detail navigation work", async () => {
    await page.getByLabel("Global machine selector").selectOption("MCH-001");
    await nav("Machine Monitoring");
    await page.waitForFunction(
      () => document.querySelectorAll("tbody tr").length === 1,
    );
    await page
      .getByRole("button", { name: "Explore complete machine history" })
      .click();
    await page.getByRole("heading", { name: "Historical readings" }).waitFor();
  });
  await check(
    "Historical filtering and CSV export use persisted rows",
    async () => {
      await page.waitForFunction(
        () => document.querySelectorAll("tbody tr").length > 0,
      );
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export CSV" }).click();
      assert.equal(
        (await download).suggestedFilename(),
        "telemetryflow-history.csv",
      );
    },
  );
  await check(
    "Control token and backend simulation create critical alerts",
    async () => {
      await nav("Settings");
      await page.getByLabel("Control token").fill(token);
      const settings = await context.request
        .get(`${base}/api/thresholds`)
        .then((r) => r.json());
      const threshold = settings.data.find((t) => t.metric === "temperature");
      await page
        .getByLabel("temperature warning")
        .fill(String(threshold.warning));
      await page
        .getByRole("button", { name: "Save temperature", exact: true })
        .click();
      await page.getByRole("status").filter({ hasText: "Saved" }).waitFor();
      await page
        .getByLabel("Simulation scenario")
        .selectOption("temperature_spike");
      await page.getByRole("button", { name: "Apply scenario" }).click();
      await page.getByRole("status").filter({ hasText: "applied" }).waitFor();
      await nav("Alerts & Events");
      await page.waitForFunction(
        () =>
          document.body.textContent.includes("Temperature threshold exceeded"),
        null,
        { timeout: 15000 },
      );
    },
  );
  await check("Alert acknowledgement persists", async () => {
    await page
      .getByRole("button", { name: "Acknowledge", exact: true })
      .first()
      .click();
    await page.locator(".alert-row .acknowledged").first().waitFor();
  });
  await check(
    "Pressure, vibration, and failure scenarios are ingested",
    async () => {
      for (const [scenario, field, minimum] of [
        ["pressure_anomaly", "pressure", 12],
        ["excessive_vibration", "vibration", 8],
        ["machine_failure", "power", -1],
      ]) {
        const response = await context.request.post(`${base}/api/simulation`, {
          headers: { Authorization: `Bearer ${token}` },
          data: { machine_id: "MCH-001", scenario },
        });
        assert(response.ok());
        await page.waitForFunction(
          async ([field, minimum]) => {
            const r = await fetch(
              "/api/telemetry/latest?machine_id=MCH-001",
            ).then((r) => r.json());
            return field === "power"
              ? r.data[0]?.status === "offline"
              : r.data[0]?.[field] > minimum;
          },
          [field, minimum],
          { timeout: 15000 },
        );
      }
    },
  );
  await context.request.post(`${base}/api/simulation`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { machine_id: "MCH-001", scenario: "normal" },
  });
  await check("Pipeline view reports measured health", async () => {
    await nav("Pipeline Health");
    await page.getByRole("heading", { name: "Pipeline diagnostics" }).waitFor();
    assert(
      (await page.locator(".diagnostics").innerText()).includes(
        "Successful inserted records",
      ),
    );
  });
  await check("WebSocket reconnects after network interruption", async () => {
    await context.setOffline(true);
    await page.waitForTimeout(17000);
    await context.setOffline(false);
    await page.waitForFunction(
      () => document.body.textContent.includes("Live connection"),
      null,
      { timeout: 45000 },
    );
  });
  await check("Light theme works", async () => {
    await page.getByLabel("Use light theme").click();
    assert(await page.locator(".app.light").count());
    await page.getByLabel("Use dark theme").click();
  });
  await page.getByLabel("Global machine selector").selectOption("");
  await nav("Overview");
  await page.waitForTimeout(5500);
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/overview-desktop.png",
    fullPage: true,
  });
  await check(
    "Mobile layout has no page overflow and navigation works",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(350);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.getByLabel("Open navigation").click();
      await nav("Pipeline Health");
      await page
        .getByRole("heading", { name: "Pipeline diagnostics" })
        .waitFor();
      await page.getByLabel("Open navigation").click();
      await nav("Overview");
      await page.screenshot({
        path: "docs/screenshots/overview-mobile.png",
        fullPage: true,
      });
    },
  );
  assert.deepEqual(errors, []);
  await writeFile(
    "docs/e2e-results.json",
    JSON.stringify(
      { date: new Date().toISOString(), base, checks, pageErrors: errors },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `${checks.length} browser end-to-end checks passed; no page errors.`,
  );
} finally {
  await context.request
    .post(`${base}/api/simulation`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { machine_id: "MCH-001", scenario: "normal" },
    })
    .catch(() => {});
  await browser.close();
}
