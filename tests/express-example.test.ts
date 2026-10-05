import { test } from "node:test";
import assert from "node:assert/strict";
import { scan, analyseCode } from "../packages/analysis-core/src/index.ts";
import {
  runExpressBenchmark,
  parseBenchmarkArgs,
  loadReference,
} from "../scripts/express-benchmark.ts";
import {
  DEFAULT_BENCHMARK_CONFIG,
  benchmarkSchema,
  scenarioEstimate,
  stats,
  summariseBenchmark,
} from "../packages/shared/src/benchmark.ts";
import { createServer, Agent } from "node:http";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp, apiErrors } from "../apps/api/src/app.ts";
import { openStore } from "../apps/api/src/store.ts";
import { spawnSync } from "node:child_process";
test("narrow reference-data rule: request-time positive, startup cache and dynamic paths negative", async () => {
  const before = await scan("examples/express-reference/before", {
      synthetic: true,
    }),
    after = await scan("examples/express-reference/after", { synthetic: true });
  assert.equal(
    before.findings.filter((f) => f.ruleId === "request-reference-json").length,
    1,
  );
  assert.equal(after.findings.length, 0);
  assert.ok(before.detection.includes("JavaScript"));
  const prefix =
    "import express from 'express'; import fs from 'node:fs'; const app=express();";
  for (const body of [
    "app.get('/',(req,res)=>res.json(JSON.parse(fs.readFileSync(req.query.file,'utf8'))))",
    "function helper(){return JSON.parse(fs.readFileSync('x.json','utf8'))}",
    "app.get('/',(req,res)=>{const JSON={parse:x=>x};return JSON.parse(fs.readFileSync('x.json','utf8'))})",
    "app.get('/',(req,res)=>{const fs={readFileSync:()=>''};return JSON.parse(fs.readFileSync('x.json','utf8'))})",
    "let file='x.json';file=getPath();app.get('/',(req,res)=>JSON.parse(fs.readFileSync(file,'utf8')))",
  ])
    assert.equal(
      analyseCode(prefix + body, "app.js").filter(
        (f) => f.ruleId === "request-reference-json",
      ).length,
      0,
    );
});
test("allowlist rejects source paths and commands before any application execution", () => {
  assert.throws(() => parseBenchmarkArgs(["--command", "node evil.js"]));
  assert.throws(() => parseBenchmarkArgs(["--path", "/tmp/upload"]));
  assert.throws(() => parseBenchmarkArgs(["--runs", "2"]));
  assert.throws(() => parseBenchmarkArgs(["--requests", "Infinity"]));
  const child = spawnSync(
    process.execPath,
    ["scripts/express-target.mjs", "/tmp/upload/app.js"],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /allowlisted/);
});
test("real benchmark validates equivalent responses, separate target metrics and honest scenario comparisons", async () => {
  const config = {
    ...DEFAULT_BENCHMARK_CONFIG,
    requests: 100,
    warmupRequests: 20,
    pairs: 3,
    concurrency: 2,
  };
  const b = await runExpressBenchmark(config);
  assert.equal(benchmarkSchema.parse(b).runs.length, 6);
  for (const r of b.runs) {
    assert.equal(r.error, undefined);
    assert.equal(r.load.successful, 100);
    assert.equal(r.load.failed, 0);
    assert.equal(r.warmup.successful, 20);
    assert.equal(r.load.payloadBytes, b.responsePayloadBytes * 100);
    assert.ok(r.target!.elapsedMs > 0);
    assert.ok(r.target!.cpuUserMs + r.target!.cpuSystemMs > 0);
    assert.notEqual(r.target!.processId, process.pid);
    assert.ok(r.target!.rssEndBytes > 0);
  }
  assert.equal(new Set(b.runs.map((r) => r.target!.processId)).size, 6);
  assert.equal(summariseBenchmark(b).blocker, null);
  assert.equal(summariseBenchmark(b).before.carbon!.count, 3);
  const oneHour = scenarioEstimate(3600000, 1000, b.scenario);
  assert.equal(oneHour.kWh, 0.01);
  assert.equal(oneHour.grams, 4);
  assert.equal(oneHour.gramsPer1000, 4);
  assert.equal(scenarioEstimate(1000, 0, b.scenario).gramsPer1000, null);
  assert.throws(() => scenarioEstimate(-1, 100, b.scenario));
  assert.throws(() => scenarioEstimate(Infinity, 100, b.scenario));
  assert.equal(stats([1, 2, 3])!.mean, 2);
  assert.equal(stats([1, 2, 3])!.standardDeviation, Math.sqrt(2 / 3));
  const higher = structuredClone(b);
  for (const r of higher.runs)
    r.target!.elapsedMs = r.variant === "before" ? 1000 : 2000;
  assert.equal(summariseBenchmark(higher).direction, "Higher estimate");
  assert.equal(summariseBenchmark(higher).percentage, 100);
  const zero = structuredClone(higher);
  for (const r of zero.runs)
    if (r.variant === "before") r.target!.elapsedMs = 0;
  assert.equal(summariseBenchmark(zero).percentage, null);
  const failures = structuredClone(b);
  failures.runs[0].load.failed = 1;
  failures.runs[0].load.successful = 99;
  failures.runs[0].load.networkErrors = 1;
  assert.equal(summariseBenchmark(failures).percentage, null);
  assert.match(summariseBenchmark(failures).blocker!, /Failed/);
  for (const change of [
    (x: typeof b) => {
      x.runs[0].config.concurrency = 3;
    },
    (x: typeof b) => {
      x.runs[0].scenario.allocatedPowerWatts = 20;
    },
    (x: typeof b) => {
      x.runs.pop();
    },
    (x: typeof b) => {
      x.runs[0].environmentId = "0".repeat(64);
    },
  ]) {
    const incompatible = structuredClone(b);
    change(incompatible);
    assert.equal(summariseBenchmark(incompatible).percentage, null);
    assert.ok(summariseBenchmark(incompatible).blocker);
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "express-api-test-"));
  const db = openStore(dir);
  const app = createApp(db, path.join(dir, "temporary"));
  app.use(apiErrors);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    assert.deepEqual(
      await (await fetch(base + "/api/examples/express")).json(),
      { benchmark: null, job: null, jobs: [] },
    );
    await fs.writeFile(
      path.join(dir, "express-example.json"),
      JSON.stringify(b),
    );
    assert.deepEqual(
      ((await (await fetch(base + "/api/examples/express")).json()) as any)
        .benchmark,
      b,
    );
    const exportResponse = await fetch(base + "/api/examples/express/export");
    assert.match(
      exportResponse.headers.get("content-disposition")!,
      /airbus-express-sample-benchmark/,
    );
    assert.deepEqual(await exportResponse.json(), b);
    assert.equal(
      (
        await fetch(base + "/api/examples/express", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: "/tmp/upload/app.js",
            command: "touch should-not-exist",
          }),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(base + "/api/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectName: "Invalid benchmark import",
            report: b,
          }),
        })
      ).status,
      400,
    );
    await fs.writeFile(
      path.join(dir, "express-example.json"),
      '{"schemaVersion":"invalid"}',
    );
    assert.equal((await fetch(base + "/api/examples/express")).status, 422);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("load generator retains invalid responses as failures instead of counting them as work", async () => {
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end('{"wrong":true}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const agent = new Agent({ keepAlive: true, maxSockets: 2 });
  try {
    const result = await loadReference(
      (server.address() as any).port,
      Buffer.from('{"correct":true}'),
      10,
      { ...DEFAULT_BENCHMARK_CONFIG, concurrency: 2 },
      agent,
    );
    assert.equal(result.successful, 0);
    assert.equal(result.failed, 10);
    assert.equal(result.invalidResponses, 10);
    assert.ok(result.payloadBytes > 0);
    assert.equal(result.successfulPayloadBytes, 0);
  } finally {
    agent.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
