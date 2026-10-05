import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const data = await mkdtemp(path.join(os.tmpdir(), "green-browser-"));
const port = 3187;
const base = `http://127.0.0.1:${port}`;
const launch = () =>
  spawn(process.execPath, ["--import", "tsx", "apps/api/src/server.ts"], {
    env: { ...process.env, PORT: String(port), GREEN_IT_DATA: data },
    stdio: "pipe",
  });
let server = launch();
let logs = "";
server.stdout.on("data", (b) => (logs += b));
server.stderr.on("data", (b) => (logs += b));
let browser;
try {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/api/projects")).ok) break;
    } catch {}
    if (i === 79) throw new Error("Server failed: " + logs);
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: base,
  });
  const external: string[] = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== base) {
      external.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  async function narrow(name: string) {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
      `${name} should not overflow`,
    );
    await page.screenshot({
      path: `playwright-results/${name}-mobile.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.keyboard.press("Tab");
  assert.ok(
    await page.evaluate(() => document.activeElement?.tagName !== "BODY"),
  );

  await page.getByText("No analyses yet").waitFor();
  await mkdir("playwright-results", { recursive: true });
  await page.screenshot({
    path: "playwright-results/overview-empty.png",
    fullPage: true,
  });
  assert.equal(await page.title(), "Airbus Green IT Insights");
  assert.equal(
    await page
      .locator(".brand img")
      .evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
    true,
  );
  // Reproduce the original stale background error, then verify recovery and navigation isolation.
  await page.route("**/api/projects", (r) => r.abort("connectionfailed"));
  await page
    .getByRole("alert")
    .filter({ hasText: "Unable to load projects" })
    .waitFor();
  await page
    .getByRole("button", { name: "Analyse application", exact: false })
    .first()
    .click();
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Unable to load projects" })
    .waitFor();
  await page.unroute("**/api/projects");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.getByRole("alert").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await page.getByRole("heading", { name: "Help", exact: true }).waitFor();
  await page.screenshot({
    path: "playwright-results/help.png",
    fullPage: true,
  });
  await narrow("help");
  await page
    .getByText("Understanding carbon estimates", { exact: true })
    .click();
  await page
    .getByText(
      /The supported Express example collects workload evidence automatically/,
    )
    .waitFor();
  await page
    .getByRole("button", { name: "Analyse application", exact: false })
    .first()
    .click();
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.screenshot({
    path: "playwright-results/new-source.png",
    fullPage: true,
  });
  await narrow("new-source");
  await page.getByText("Upload source code (ZIP)", { exact: true }).click();
  await page
    .getByText("Advanced options — report import and local scanner", {
      exact: true,
    })
    .click();
  await page.getByRole("tab", { name: "Upload source code" }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page
      .getByRole("tab", { name: "Upload scan report" })
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await page.getByText(/3,000 entries/).count(), 0);
  await page.screenshot({
    path: "playwright-results/new-report.png",
    fullPage: true,
  });
  await narrow("new-report");
  await page.keyboard.press("ArrowRight");
  await page
    .getByRole("heading", { name: "Scan a project on your computer" })
    .waitFor();
  await page.getByRole("button", { name: "Copy command", exact: true }).click();
  await page.getByRole("button", { name: "Copied", exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "npm run scan -- /path/to/your-project --output /tmp/green-it-report.json",
  );
  await page.screenshot({
    path: "playwright-results/new-computer.png",
    fullPage: true,
  });
  await narrow("new-computer");
  await page
    .getByRole("button", { name: "Upload scan report", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("tab", { name: "Upload scan report" })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.getByRole("tab", { name: "Upload source code" }).click();
  await page.getByText("Additional options", { exact: true }).click();
  assert.equal(await page.getByLabel("This is sample data").isChecked(), false);
  await page.getByLabel("Project name").fill("Synthetic browser demo");
  await page
    .getByLabel("Source code ZIP", { exact: true })
    .setInputFiles("examples/generated/before.zip");
  await page.getByLabel("This is sample data").check();
  await page.route("**/api/upload", (r) => r.abort("connectionfailed"));
  await page.getByRole("button", { name: "Start analysis" }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Unable to upload source code" })
    .waitFor();
  await page.unroute("**/api/upload");
  await page.getByRole("button", { name: "Retry", exact: true }).click();

  await page
    .getByRole("heading", { name: "Findings to review" })
    .waitFor({ timeout: 20000 });
  assert.equal(await page.locator(".finding").count(), 5);
  await page.getByText("Sample data", { exact: true }).waitFor();
  assert.equal(await page.getByRole("alert").count(), 0);
  await page
    .getByText("Advanced diagnostic tools — supplied carbon inputs", {
      exact: true,
    })
    .click();
  await page
    .getByText("Carbon estimate unavailable — measurement inputs required.", {
      exact: true,
    })
    .waitFor();
  await page
    .getByText("Suggested improvement & verification", { exact: true })
    .first()
    .click();
  await page.getByLabel("Confidence", { exact: true }).selectOption("medium");
  assert.equal(await page.locator(".finding").count(), 1);
  await page.getByLabel("Confidence", { exact: true }).selectOption("all");
  const op = page.locator(".calculator").nth(0);
  await op.getByLabel("Energy consumption (kWh)").fill("0.25");
  await op.getByLabel("Electricity intensity (gCO₂e/kWh)").fill("400");
  await op.getByLabel("Input provenance").selectOption("synthetic");
  await op
    .getByLabel("Period / comparison basis")
    .fill("one synthetic 60-minute test");
  await op
    .getByLabel("System boundary")
    .fill("synthetic server wall-plug electricity only");
  await op
    .getByLabel("Workload description")
    .fill("synthetic fixed request batch");
  await op.getByLabel("Completed work count (optional)").fill("1000");
  await op.getByLabel("Work unit (paired with count)").fill("requests");
  await op.getByRole("button", { name: "Calculate & save" }).click();
  await op.getByText("100 gCO₂e", { exact: true }).waitFor();
  await op.getByText("0.1 gCO₂e / requests", { exact: true }).waitFor();
  const tr = page.locator(".calculator").nth(1);
  await tr.getByLabel("Transferred application bytes").fill("100000000");
  await tr.getByLabel("Input provenance").selectOption("synthetic");
  await tr
    .getByLabel("Period / comparison basis")
    .fill("one synthetic 60-minute test");
  await tr
    .getByLabel("System boundary")
    .fill("web delivery, SWD v4 model boundary");
  await tr
    .getByLabel("Workload description")
    .fill("synthetic fixed request batch");
  await tr.getByRole("button", { name: "Calculate & save" }).click();
  await tr.getByText("14.82 gCO₂e", { exact: true }).waitFor();
  await page.screenshot({
    path: "playwright-results/scan-details.png",
    fullPage: true,
  });
  await narrow("scan-details");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export JSON" }).click();
  const download = await downloadPromise;
  assert.match(
    download.suggestedFilename(),
    /^airbus-green-it-insights-sample-data-/,
  );
  await download.saveAs("playwright-results/export.json");
  const exported = JSON.parse(
    await readFile("playwright-results/export.json", "utf8"),
  );
  assert.equal(exported.provenance.synthetic, true);
  assert.equal(exported.tool.name, "green-it");
  assert.equal(exported.schemaVersion, "1.0");
  assert.equal(exported.carbon.operational.kWh, 0.25);
  assert.equal(exported.carbon.transfer.packageVersion, "0.18.0");
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator(".sidebar").isVisible(), false);
  await page
    .locator(".print-brand")
    .getByText("Airbus Green IT Insights", { exact: true })
    .waitFor();
  await page.getByText("Sample data", { exact: true }).waitFor();
  assert.equal(await page.locator(".finding dl").first().isVisible(), true);
  await page.pdf({
    path: "playwright-results/report.pdf",
    format: "A4",
    printBackground: true,
  });
  await page.emulateMedia({ media: "screen" });
  const persistedId = (
    await (await context.request.get(base + "/api/scans")).json()
  )[0].id;
  server.kill("SIGTERM");
  await new Promise<void>((resolve) => server.once("exit", () => resolve()));
  server = launch();
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/api/projects")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const persisted = await (
    await context.request.get(base + "/api/scans/" + persistedId)
  ).json();
  assert.equal(persisted.report.carbon.operational.kWh, 0.25);
  assert.equal(persisted.report.carbon.transfer.bytes, 100000000);

  await page
    .getByRole("button", { name: "Analyse application", exact: false })
    .first()
    .click();
  await page.getByText("Upload source code (ZIP)", { exact: true }).click();
  await page
    .getByText("Advanced options — report import and local scanner", {
      exact: true,
    })
    .click();
  await page.getByRole("tab", { name: "Upload scan report" }).click();
  await page.getByLabel("Project name").fill("Synthetic browser demo");
  await page.getByLabel("Scan report (.json)").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":"unsupported"}'),
  });
  await page
    .getByRole("button", { name: "Upload report", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Unable to upload the scan report" })
    .waitFor();
  await page
    .getByLabel("Scan report (.json)")
    .setInputFiles("examples/generated/after.json");
  await page.getByRole("button", { name: "Upload report" }).click();
  await page.getByText("Uploaded report", { exact: true }).waitFor();
  await page.getByText("Report information", { exact: true }).click();
  await page
    .getByText(/Imported results are not independently verified/)
    .waitFor();
  await page
    .locator("nav")
    .getByRole("button", { name: "Results/comparison" })
    .click();
  await page
    .getByRole("button", { name: "Compare source scans", exact: true })
    .click();
  await page
    .getByLabel("Project", { exact: true })
    .selectOption({ label: "Synthetic browser demo" });
  const options = await page
    .getByLabel("Baseline")
    .locator("option")
    .allTextContents();
  const before = options.find((x) => x.includes("5 findings"))!;
  const after = options.find((x) => x.includes("0 findings"))!;
  await page.getByLabel("Baseline").selectOption({ label: before });
  await page.getByLabel("Revised").selectOption({ label: after });
  await page
    .getByRole("button", { name: "Compare scans", exact: true })
    .click();
  await page.getByRole("heading", { name: "resolved", exact: true }).waitFor();
  assert.equal(
    await page
      .locator(".metrics .metric")
      .nth(1)
      .locator("strong")
      .textContent(),
    "5",
  );
  await page.screenshot({
    path: "playwright-results/comparison.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Overview", exact: false }).click();
  await page.screenshot({
    path: "playwright-results/overview-populated.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "playwright-results/mobile.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  // Imported markup must remain text, even when valid schema fields contain HTML.
  const attack = JSON.parse(
    await readFile("examples/generated/before.json", "utf8"),
  );
  attack.findings[0].title = '<img src=x onerror="window.__injected=true">';
  const malicious = await context.request.post(base + "/api/import", {
    data: { projectName: "<svg onload=alert(1)>", report: attack },
  });
  assert.equal(malicious.status(), 201);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Overview", exact: false }).click();
  await page
    .getByRole("button", { name: "<svg onload=alert(1)>", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "<svg onload=alert(1)>", exact: true })
    .click();
  await page
    .getByRole("heading", { name: attack.findings[0].title, exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(() => (window as any).__injected),
    undefined,
  );
  assert.equal(await page.locator("main img").count(), 0);
  await page.getByRole("button", { name: "Overview", exact: false }).click();
  page.on("dialog", (d) => d.accept());
  await page
    .locator(".project-row")
    .filter({ hasText: "<svg onload=alert(1)>" })
    .getByRole("button", { name: "Delete" })
    .click();
  await page.waitForFunction(
    () =>
      !document.querySelector(".project-row")?.textContent?.includes("<svg"),
  );
  await page
    .locator(".project-row")
    .filter({ hasText: "Synthetic browser demo" })
    .getByRole("button", { name: "Delete" })
    .click();
  await page.getByText("No analyses yet").waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "Browser PASS: Airbus branding, API failure/recovery, three analysis tabs, clipboard, sample labels, help, empty/loaded overview, ZIP, invalid/valid import, filters, two calculators, persisted export, actual server restart, keyboard focus, print media/PDF, comparison, responsive layout, XSS-safe rendering, deletion, no external requests or page errors.",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise<void>((r) => {
    if (server.exitCode !== null) r();
    else server.once("exit", () => r());
  });
  await rm(data, { recursive: true, force: true });
}
