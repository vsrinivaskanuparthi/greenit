import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { once } from "node:events";
import { co2 } from "@tgwf/co2";
import { readHar, estimateTraffic } from "../apps/api/src/traffic.ts";
import { runTrafficJourney } from "../scripts/express-benchmark.ts";
import { analyseCode, scan } from "../packages/analysis-core/src/index.ts";
import { extractZip } from "../apps/api/src/archive.ts";
import { openStore } from "../apps/api/src/store.ts";
import { createApp, apiErrors } from "../apps/api/src/app.ts";
import { startJobs } from "../apps/api/src/jobs.ts";
const har = (entries: any[]) => ({ log: { version: "1.2", entries } });
const entry = (bodySize: any, status = 200) => ({
  request: {
    method: "GET",
    url: "https://user:password@private.invalid/orders/SECRET?token=SECRET",
    headers: [{ name: "Cookie", value: "SECRET" }],
    postData: { text: "SECRET" },
  },
  response: {
    status,
    bodySize,
    headers: [{ name: "Set-Cookie", value: "SECRET" }],
    content: { size: 99999, text: "SECRET" },
  },
});
test("HAR encoded body evidence: unknown is not zero; cached, invalid and failed entries; sanitisation and pinned CO2 model", () => {
  const input = har([
    entry(100),
    entry(0),
    entry(-1),
    entry(undefined),
    entry(-4),
    entry("50"),
    { ...entry(500), _fromCache: true },
    entry(50, 500),
    entry(100, 0),
    entry(999, 304),
    entry(0, 304),
    {
      ...entry(80),
      response: { ...entry(80).response, _fromServiceWorker: true },
    },
  ]);
  const evidence = readHar(input),
    result = estimateTraffic(evidence);
  assert.equal(result.recordedBytes, 150);
  assert.equal(result.includedRequests, 4);
  assert.equal(result.excludedRequests, 8);
  assert.equal(
    result.grams,
    new co2({ model: "swd", version: 4 }).perByte(150, false),
  );
  assert.equal(result.model.packageVersion, "0.18.0");
  assert.equal(result.model.greenHosting, false);
  const serial = JSON.stringify(result);
  for (const secret of [
    "SECRET",
    "private.invalid",
    "Cookie",
    "headers",
    "postData",
    "text",
    "url",
  ])
    assert.equal(serial.includes(secret), false);
  assert.equal(estimateTraffic(readHar(har([entry(-1)]))).grams, null);
  assert.equal(estimateTraffic(readHar(har([entry(0)]))).grams, 0);
  assert.equal(
    estimateTraffic(evidence).grams,
    result.grams,
    "unchanged bytes must not invent a reduction",
  );
  assert.throws(() => readHar({ log: { version: "2", entries: [] } }));
  assert.throws(() => readHar(har(Array(5001).fill(entry(1)))));
});
test("controlled catalogue journey uses real equivalent business tasks and byte evidence; single/ZIP findings agree", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-journey-"));
  try {
    const s = await runTrafficJourney(dir);
    assert.equal(s.journeys.length, 6);
    assert.equal(new Set(s.journeys.map((j) => j.pid)).size, 6);
    for (const j of s.journeys) {
      assert.equal(j.successful, 7);
      assert.equal(j.failed, 0);
      assert.equal(j.taskEquivalent, true);
      assert.ok(estimateTraffic(j.evidence).recordedBytes > 0);
    }
    const before = s.journeys.find((j) => j.variant === "before")!,
      after = s.journeys.find((j) => j.variant === "after")!;
    const beforeEstimate = estimateTraffic(before.evidence),
      afterEstimate = estimateTraffic(after.evidence);
    assert.ok(beforeEstimate.recordedBytes > afterEstimate.recordedBytes);
    for (const label of [
      "GET /reference-data",
      "GET /products/:id",
      "GET /orders/:id/summary",
      "GET /availability/:id",
    ])
      assert.equal(
        before.evidence.entries.find((e: any) => e.label === label).bytes,
        after.evidence.entries.find((e: any) => e.label === label).bytes,
      );
    const lines = s.beforeCode
      .split("\n")
      .filter((l: string) => l.trim() && !l.trim().startsWith("//"));
    assert.ok(lines.length >= 100);
    assert.ok(s.findings.some((f) => f.ruleId === "request-reference-json"));
    assert.ok(s.findings.every((f) => f.line > 0));
    assert.equal(
      analyseCode(s.afterCode, "server.js").filter(
        (f) => f.ruleId === "request-reference-json",
      ).length,
      0,
    );
    const extracted = path.join(dir, "zip");
    await extractZip("examples/generated/ecolens-express.zip", extracted);
    const report = await scan(extracted);
    assert.deepEqual(
      report.findings
        .filter((f) => f.file === "server.js")
        .map((f) => [f.ruleId, f.line]),
      s.findings.map((f) => [f.ruleId, f.line]),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("source plus HAR upload persists only sanitised results, does not execute source, cleans temporary data and preserves existing records", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eco-api-")),
    temp = path.join(dir, "temporary"),
    db = openStore(dir);
  db.prepare("INSERT INTO projects VALUES(?,?,?)").run(
    "existing",
    "Existing project",
    new Date().toISOString(),
  );
  const jobs = await startJobs(db, dir, temp);
  const app = createApp(db, temp);
  app.use(apiErrors);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const wait = async (id: string) => {
    for (let i = 0; i < 150; i++) {
      const r = (await (
        await fetch(base + "/api/eco/results/" + id)
      ).json()) as any;
      if (["completed", "failed"].includes(r.status)) return r;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error("Timeout");
  };
  try {
    assert.equal(
      (
        await fetch(base + "/api/eco/example", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: "/tmp/upload.js" }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + "/api/eco/example", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://untrusted.invalid",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    const oversized = new FormData();
    oversized.append(
      "source",
      new Blob(["x".repeat(1024 * 1024 + 1)]),
      "server.js",
    );
    assert.equal(
      (
        await fetch(base + "/api/eco/analyse", {
          method: "POST",
          body: oversized,
        })
      ).status,
      400,
    );
    const tripwire = path.join(dir, "executed");
    const source = `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(tripwire)},'bad');setInterval(()=>fetch('/poll'),100);`;
    const body = new FormData();
    body.append("source", new Blob([source]), "server.js");
    body.append(
      "har",
      new Blob([JSON.stringify(har([entry(321), entry(-1)]))]),
      "capture.har",
    );
    const response = await fetch(base + "/api/eco/analyse", {
      method: "POST",
      body,
    });
    assert.equal(response.status, 202);
    const { id } = (await response.json()) as any;
    const r = await wait(id);
    assert.equal(r.status, "completed");
    assert.equal(r.result.traffic.recordedBytes, 321);
    assert.ok(
      r.result.source.findings.some((f: any) => f.ruleId === "short-interval"),
    );
    assert.equal(JSON.stringify(r).includes("SECRET"), false);
    await assert.rejects(fs.stat(tripwire));
    const solo = new FormData();
    solo.append("source", new Blob([source]), "server.js");
    const soloId = (
      (await (
        await fetch(base + "/api/eco/analyse", { method: "POST", body: solo })
      ).json()) as any
    ).id;
    const soloResult = await wait(soloId);
    assert.equal(soloResult.result.traffic, null);
    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(await fs.readdir(temp), []);
    assert.ok(db.prepare("SELECT id FROM projects WHERE id='existing'").get());
    assert.equal(
      (
        (await (
          await fetch(base + "/api/eco/results/" + id + "/export")
        ).json()) as any
      ).traffic.recordedBytes,
      321,
    );
    const stored = db
      .prepare("SELECT traffic,result FROM eco_reports WHERE id=?")
      .get(id) as any;
    assert.equal(stored.traffic, null);
    assert.equal(stored.result.includes("SECRET"), false);
    const invalid = new FormData();
    invalid.append("har", new Blob(["bad"]), "bad.har");
    assert.equal(
      (
        await fetch(base + "/api/eco/analyse", {
          method: "POST",
          body: invalid,
        })
      ).status,
      400,
    );
  } finally {
    await jobs.stop();
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    const reopened = openStore(dir);
    assert.ok(
      reopened.prepare("SELECT id FROM projects WHERE id='existing'").get(),
    );
    assert.equal(
      (reopened.prepare("SELECT COUNT(*) n FROM eco_reports").get() as any).n,
      2,
    );
    reopened.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
