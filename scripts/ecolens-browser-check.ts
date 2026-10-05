import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const data = await mkdtemp(path.join(os.tmpdir(), "ecolens-browser-")),
  base = "http://127.0.0.1:3189";
const launch = () =>
  spawn(process.execPath, ["--import", "tsx", "apps/api/src/server.ts"], {
    env: { ...process.env, PORT: "3189", GREEN_IT_DATA: data },
    stdio: "ignore",
  });
let server = launch(),
  browser;
async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/eco/info")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("Server unavailable");
}
async function stop() {
  server.kill("SIGTERM");
  await new Promise<void>((r) => {
    if (server.exitCode !== null) r();
    else server.once("exit", () => r());
  });
}
try {
  await ready();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const external: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", (r) => {
    if (new URL(r.request().url()).origin !== base) {
      external.push(r.request().url());
      return r.abort();
    }
    return r.continue();
  });
  await mkdir("playwright-results", { recursive: true });
  await page.goto(base);
  assert.equal(await page.title(), "EcoLens Airbus");
  assert.deepEqual(await page.locator("nav button").allTextContents(), [
    "Home",
    "Use EcoLens",
    "How it works",
  ]);
  await page.screenshot({
    path: "playwright-results/ecolens-home.png",
    fullPage: true,
  });
  await page
    .locator("nav")
    .getByRole("button", { name: "Use EcoLens", exact: true })
    .click();
  await page.screenshot({
    path: "playwright-results/ecolens-use.png",
    fullPage: true,
  });
  const downloaded = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download sample server.js" }).click();
  assert.equal((await downloaded).suggestedFilename(), "server.js");
  await page
    .getByRole("button", { name: "Try Express example", exact: true })
    .click();
  await page.getByTestId("carbon-after").waitFor({ timeout: 30000 });
  assert.equal(await page.locator("input[type=number]").count(), 0);
  assert.equal(await page.getByText(/10 W allocation/).count(), 0);
  const reports = await (await fetch(base + "/api/eco/results")).json();
  const id = reports[0].id;
  const result = (await (await fetch(base + "/api/eco/results/" + id)).json())
    .result;
  assert.equal(result.sample.journeys.length, 6);
  assert.ok(
    result.sample.journeys.every(
      (j: any) => j.taskEquivalent && j.failed === 0,
    ),
  );
  assert.ok(
    result.sample.before[0].recordedBytes >
      result.sample.after[0].recordedBytes,
  );
  assert.equal(result.traffic.model.modelVersion, 4);
  await page.getByText("See the illustration", { exact: true }).click();
  await page.getByRole("button", { name: "Pause illustration" }).click();
  assert.equal(
    await page
      .locator(".transfer-flow b")
      .first()
      .evaluate((e) => getComputedStyle(e).animationPlayState),
    "paused",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".transfer-flow b")
      .first()
      .evaluate((e) => getComputedStyle(e).animationName),
    "none",
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "playwright-results/ecolens-result.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: "playwright-results/ecolens-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const exp = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download report", exact: true })
    .click();
  assert.equal((await exp).suggestedFilename(), "ecolens-airbus-report.json");
  await page
    .getByLabel("Source code (optional)", { exact: false })
    .setInputFiles("examples/ecolens-express/server.js");
  await page.getByRole("button", { name: "Analyse", exact: true }).click();
  await page
    .getByText(
      "Add a network recording to estimate transfer-related emissions.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await page.getByTestId("traffic-carbon").count(), 0);
  await page
    .getByText("Reference JSON read and parsed on every request", {
      exact: true,
    })
    .waitFor();
  const har = {
    log: {
      version: "1.2",
      entries: [
        {
          request: {
            method: "GET",
            url: "https://private.invalid/?token=HAR_TOKEN_829461",
          },
          response: {
            status: 200,
            bodySize: 100000,
            content: { text: "HAR_TOKEN_829461", size: 800000 },
          },
        },
        { response: { status: 200, bodySize: -1 } },
      ],
    },
  };
  await page
    .getByLabel("Network recording (optional)", { exact: false })
    .setInputFiles({
      name: "capture.har",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(har)),
    });
  await page.getByRole("button", { name: "Analyse", exact: true }).click();
  await page.getByTestId("traffic-carbon").waitFor();
  assert.equal(
    await page.getByTestId("traffic-carbon").innerText(),
    "14.8 mg CO₂e",
  );
  assert.equal(
    await page.getByText("HAR_TOKEN_829461", { exact: false }).count(),
    0,
  );
  await page.route("**/api/eco/analyse", (r) => r.abort("connectionfailed"));
  await page.getByRole("button", { name: "Analyse", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await page.unroute("**/api/eco/analyse");
  await page.getByRole("button", { name: "Analyse", exact: true }).click();
  await page.getByRole("alert").waitFor({ state: "hidden" });
  await page.getByTestId("traffic-carbon").waitFor();
  await page
    .locator("nav")
    .getByRole("button", { name: "How it works" })
    .click();
  await page.getByText(/@babel\/parser 7.29.9/).waitFor();
  await page.screenshot({
    path: "playwright-results/ecolens-how.png",
    fullPage: true,
  });
  await page.keyboard.press("Tab");
  assert.notEqual(
    await page.evaluate(() => document.activeElement?.tagName),
    "BODY",
  );
  await stop();
  server = launch();
  await ready();
  assert.deepEqual(
    (await (await fetch(base + "/api/eco/results/" + id)).json()).result,
    result,
  );
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  console.log(
    "EcoLens browser PASS: three screens, one-action real journey, downloads, task equivalence, source-only and source+HAR, pinned carbon arithmetic, sanitisation, error recovery, animation controls, responsive layout, persisted results, no external requests.",
  );
  console.log(
    JSON.stringify({
      beforeBytes: result.sample.before[0].recordedBytes,
      afterBytes: result.sample.after[0].recordedBytes,
      beforeGrams: result.sample.before[0].grams,
      afterGrams: result.sample.after[0].grams,
    }),
  );
} finally {
  await browser?.close();
  await stop();
  await rm(data, { recursive: true, force: true });
}
