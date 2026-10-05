import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  benchmarkSchema,
  summariseBenchmark,
} from "../packages/shared/src/benchmark.ts";
const data = await mkdtemp(path.join(os.tmpdir(), "express-browser-")),
  base = "http://127.0.0.1:3188";
const launch = () =>
  spawn(process.execPath, ["--import", "tsx", "apps/api/src/server.ts"], {
    env: { ...process.env, PORT: "3188", GREEN_IT_DATA: data },
    stdio: "ignore",
  });
let server = launch(),
  browser;
async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/projects")).ok) return;
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
  await page
    .locator("nav")
    .getByRole("button", { name: "Analyse application" })
    .click();
  await page
    .getByText("Inspect the source being analysed", { exact: true })
    .click();
  const source = await (
    await fetch(base + "/api/examples/express/source")
  ).json();
  assert.equal(
    await page.locator(".sample-code code").first().textContent(),
    source.before,
  );
  assert.equal(
    await page.locator(".sample-code code").last().textContent(),
    source.after,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "playwright-results/one-stop-select.png",
    fullPage: true,
  });
  // The only presenter action: no terminal benchmark, numeric fields or seeded result.
  const queued = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/examples/express/analyse") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Analyse Express example", exact: true })
    .click();
  const { id } = await (await queued).json();
  await page.getByRole("region", { name: "Analysis progress" }).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "playwright-results/one-stop-progress.png",
    fullPage: true,
  });
  await page.getByTestId("carbon-before").waitFor({ timeout: 100000 });
  const response = await (
      await fetch(base + "/api/examples/express?job=" + id)
    ).json(),
    b = benchmarkSchema.parse(response.benchmark),
    summary = summariseBenchmark(b);
  assert.equal(response.job.status, "completed");
  for (const stage of [
    "reading",
    "checking",
    "running",
    "estimating",
    "completed",
  ])
    assert.ok(response.job.history.some((h: any) => h.stage === stage));
  assert.equal(b.sources.before.code, source.before);
  assert.equal(b.sources.after.code, source.after);
  assert.equal(b.runs.length, 12);
  assert.equal(summary.before.successful, 60000);
  assert.equal(summary.after.successful, 60000);
  assert.equal(summary.before.failed + summary.after.failed, 0);
  assert.equal(new Set(b.runs.map((r) => r.target!.processId)).size, 12);
  assert.ok(b.runs.every((r) => r.target!.cpuUserMs > 0));
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { maximumSignificantDigits: 5 });
  assert.ok(
    (await page.getByTestId("carbon-before").innerText()).includes(
      fmt(summary.before.carbon!.mean),
    ),
  );
  assert.ok(
    (await page.getByTestId("carbon-after").innerText()).includes(
      fmt(summary.after.carbon!.mean),
    ),
  );
  assert.equal(await page.locator("input[type=number]:visible").count(), 0);
  await page
    .getByRole("heading", {
      name: "Reference JSON read and parsed on every request",
    })
    .waitFor();
  await page.getByRole("button", { name: "Pause animation" }).click();
  assert.equal(
    await page
      .locator(".flow-step")
      .first()
      .evaluate((e) => getComputedStyle(e).animationPlayState),
    "paused",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".flow-step")
      .first()
      .evaluate((e) => getComputedStyle(e).animationName),
    "none",
  );
  await page.getByText("How this was calculated", { exact: true }).click();
  await page
    .getByText("CO2.js is not applied automatically here", { exact: false })
    .waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "playwright-results/one-stop-results.png",
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download benchmark JSON" }).click();
  assert.equal(
    (await download).suggestedFilename(),
    "airbus-express-sample-benchmark.json",
  );
  assert.deepEqual(
    await (await fetch(base + "/api/examples/express/export?job=" + id)).json(),
    b,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "playwright-results/one-stop-mobile.png",
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
  await page.reload();
  await page
    .locator("nav")
    .getByRole("button", { name: "Results/comparison" })
    .click();
  await page.getByTestId("carbon-before").waitFor();
  assert.deepEqual(
    (await (await fetch(base + "/api/examples/express?job=" + id)).json())
      .benchmark,
    b,
  );
  await page.route("**/api/examples/express", (r) =>
    r.abort("connectionfailed"),
  );
  await page.getByRole("alert").waitFor();
  await page.unroute("**/api/examples/express");
  await page.getByRole("alert").waitFor({ state: "hidden" });
  // An exact sample ZIP is recognised by extracted contents, then the trusted copy is run.
  await page
    .locator("nav")
    .getByRole("button", { name: "Analyse application" })
    .click();
  await page.getByText("Upload source code (ZIP)", { exact: true }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Recognised sample ZIP");
  await page
    .getByLabel("Source code ZIP", { exact: true })
    .setInputFiles("examples/generated/express-reference.zip");
  await page
    .getByRole("button", { name: "Start analysis", exact: true })
    .click();
  await page.getByTestId("carbon-before").waitFor({ timeout: 100000 });
  const scans = await (await fetch(base + "/api/scans")).json();
  const scan = await (await fetch(base + "/api/scans/" + scans[0].id)).json();
  assert.ok(scan.exampleJobId);
  assert.equal(scan.report.provenance.synthetic, true);
  assert.equal(
    (
      await (
        await fetch(base + "/api/examples/express?job=" + scan.exampleJobId)
      ).json()
    ).job.status,
    "completed",
  );
  // Unsupported source stays static; it never borrows the completed sample's estimates.
  await page
    .locator("nav")
    .getByRole("button", { name: "Analyse application" })
    .click();
  await page.getByText("Upload source code (ZIP)", { exact: true }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Unrecognised source");
  await page
    .getByLabel("Source code ZIP", { exact: true })
    .setInputFiles("examples/generated/before.zip");
  await page
    .getByRole("button", { name: "Start analysis", exact: true })
    .click();
  await page
    .getByText(
      "Code analysis complete. Automatic carbon estimation is not yet supported for this application.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await page.getByTestId("carbon-before").count(), 0);
  assert.equal(await page.locator("input[type=number]:visible").count(), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "One-stop browser PASS: real browser-triggered workload, all persisted stages, source equality, 120000 successes, calculations, animation pause/reduced motion, export, restart, API recovery, exact ZIP recognition, static-only unsupported ZIP, narrow layout, no external requests.",
  );
  console.log(
    JSON.stringify({
      before: summary.before.carbon,
      after: summary.after.carbon,
      percentage: summary.percentage,
    }),
  );
} finally {
  await browser?.close();
  await stop();
  await rm(data, { recursive: true, force: true });
}
