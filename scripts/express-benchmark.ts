import { fork, type ChildProcess } from "node:child_process";
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { scan } from "../packages/analysis-core/src/index.ts";
import {
  benchmarkSchema,
  benchmarkConfigSchema,
  scenarioSchema,
  targetMetricsSchema,
  DEFAULT_BENCHMARK_CONFIG,
  summariseBenchmark,
  type Benchmark,
  type BenchmarkConfig,
  type BenchmarkRun,
  type WorkloadMetrics,
} from "../packages/shared/src/benchmark.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
const sampleRoot = path.join(root, "examples/express-reference");
const digest = (content: string | Buffer) =>
  createHash("sha256").update(content).digest("hex");
const emptyLoad = (): WorkloadMetrics => ({
  attempted: 0,
  successful: 0,
  failed: 0,
  invalidResponses: 0,
  networkErrors: 0,
  payloadBytes: 0,
  successfulPayloadBytes: 0,
  elapsedMs: 0,
  cpuUserMs: 0,
  cpuSystemMs: 0,
});
export function parseBenchmarkArgs(args: string[]): BenchmarkConfig {
  const config = { ...DEFAULT_BENCHMARK_CONFIG };
  const flags: Record<
    string,
    "requests" | "concurrency" | "warmupRequests" | "pairs"
  > = {
    "--requests": "requests",
    "--concurrency": "concurrency",
    "--warmup": "warmupRequests",
    "--runs": "pairs",
  };
  for (let i = 0; i < args.length; i += 2) {
    const key = flags[args[i]];
    if (
      !Object.hasOwn(flags, args[i]) ||
      !key ||
      !/^\d+$/.test(args[i + 1] ?? "")
    )
      throw new Error(
        "Use only --requests N, --concurrency N, --warmup N, --runs N. Sample paths and commands are not accepted.",
      );
    config[key] = Number(args[i + 1]);
  }
  return benchmarkConfigSchema.parse(config);
}
function nextMessage(
  child: ChildProcess,
  type: string,
  timeoutMs = 10000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error("Sample process timed out")),
      timeoutMs,
    );
    const onMessage = (m: any) => {
      if (m?.type === type) finish(null, m);
    };
    const onExit = () =>
      finish(new Error("Sample process exited before reporting metrics"));
    const onError = () =>
      finish(new Error("Unable to start allowlisted sample process"));
    function finish(error: Error | null, value?: unknown) {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("exit", onExit);
      child.off("error", onError);
      error ? reject(error) : resolve(value);
    }
    child.on("message", onMessage);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}
export async function loadReference(
  port: number,
  expected: Buffer,
  requests: number,
  config: BenchmarkConfig,
  agent: http.Agent,
): Promise<WorkloadMetrics> {
  const result = emptyLoad();
  let cursor = 0;
  const cpu = process.cpuUsage(),
    start = process.hrtime.bigint();
  async function request() {
    result.attempted++;
    await new Promise<void>((resolve) => {
      let done = false;
      let received = 0;
      const finish = (valid: boolean, network: boolean, body?: Buffer) => {
        if (done) return;
        done = true;
        result.payloadBytes += received;
        if (valid) {
          result.successful++;
          result.successfulPayloadBytes += body!.length;
        } else {
          result.failed++;
          network ? result.networkErrors++ : result.invalidResponses++;
        }
        resolve();
      };
      const req = http.get(
        {
          host: "127.0.0.1",
          port,
          path: "/reference-data",
          agent,
          headers: { Accept: "application/json" },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (received > 128 * 1024) {
              finish(false, false);
              res.destroy();
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            const body = Buffer.concat(chunks);
            finish(
              res.statusCode === 200 &&
                String(res.headers["content-type"]).includes(
                  "application/json",
                ) &&
                body.equals(expected),
              false,
              body,
            );
          });
          res.on("error", () => finish(false, true));
        },
      );
      req.setTimeout(config.requestTimeoutMs, () => req.destroy());
      req.on("error", () => finish(false, true));
    });
  }
  await Promise.all(
    Array.from({ length: Math.min(config.concurrency, requests) }, async () => {
      while (cursor++ < requests) await request();
    }),
  );
  result.elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  const usage = process.cpuUsage(cpu);
  result.cpuUserMs = usage.user / 1000;
  result.cpuSystemMs = usage.system / 1000;
  return result;
}
async function stop(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  await new Promise<void>((resolve) => {
    const kill = setTimeout(() => child.kill("SIGKILL"), 1000);
    child.once("exit", () => {
      clearTimeout(kill);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
export async function runExpressBenchmark(
  configInput: BenchmarkConfig,
  onProgress: (message: string) => void = () => {},
  onStage: (
    stage: "reading" | "checking" | "running" | "estimating",
  ) => void = () => {},
): Promise<Benchmark> {
  onStage("reading");
  const config = benchmarkConfigSchema.parse(configInput);
  const scenario = scenarioSchema.parse(
    JSON.parse(
      await fs.readFile(path.join(sampleRoot, "scenario.json"), "utf8"),
    ),
  );
  const dataBytes = await fs.readFile(
    path.join(sampleRoot, "reference-data.json"),
  );
  const expected = Buffer.from(
    JSON.stringify(JSON.parse(dataBytes.toString("utf8"))),
  );
  const sourceBefore = await fs.readFile(
      path.join(sampleRoot, "before/app.js"),
      "utf8",
    ),
    sourceAfter = await fs.readFile(
      path.join(sampleRoot, "after/app.js"),
      "utf8",
    );
  const require = createRequire(import.meta.url);
  const machine = {
    node: process.version,
    express: require("express/package.json").version as string,
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    instrumentationVersion: "1.0.0" as const,
  };
  const environment = {
    ...machine,
    id: digest(JSON.stringify(machine)),
    energyCapability:
      "No application energy meter is used. The supplied model is an illustrative fixed-power scenario; this run measures resources, not electricity.",
    measurementBoundary:
      "Target-process snapshots enclose only the warmed HTTP request batch and begin/end IPC scheduling; separate load-generator process metrics.",
    limitations: [
      "Both processes share the same host; background load, thermal state, filesystem cache and scheduling are uncontrolled.",
      "Fresh target process each run; identical warm-up; no forced GC or filesystem-cache flush. Startup and initial cache loading excluded.",
      "RSS peak is sampled every 50 ms and can miss spikes; lifetime max RSS includes startup and warm-up. Heap snapshots do not isolate cache size.",
      "Response bytes are received HTTP body payload bytes, not network wire bytes. No storage/network energy is measured.",
      "No measured application power or energy; scenario factors are illustrative, not TDP or calibrated device parameters.",
    ],
  };
  onStage("checking");
  const benchmark: Benchmark = {
    schemaVersion: "express-benchmark/1.0",
    createdAt: new Date().toISOString(),
    label: "Sample application",
    provenance: {
      resources: "measured locally",
      energy: "scenario model; not measured",
      businessData: "synthetic",
      execution: "allowlisted repository samples only",
    },
    environment,
    config,
    scenario,
    dataHash: digest(dataBytes),
    expectedResponseHash: digest(expected),
    responsePayloadBytes: expected.length,
    sources: {
      before: {
        file: "examples/express-reference/before/app.js",
        sha256: digest(sourceBefore),
        code: sourceBefore,
        scan: await scan(path.join(sampleRoot, "before"), { synthetic: true }),
      },
      after: {
        file: "examples/express-reference/after/app.js",
        sha256: digest(sourceAfter),
        code: sourceAfter,
        scan: await scan(path.join(sampleRoot, "after"), { synthetic: true }),
      },
    },
    runs: [],
  };
  onStage("running");
  for (let pair = 0; pair < config.pairs; pair++)
    for (const [position, variant] of (pair % 2 === 0
      ? (["before", "after"] as const)
      : (["after", "before"] as const)
    ).entries()) {
      const run: BenchmarkRun = {
        variant,
        pair,
        position: position === 0 ? "first" : "second",
        startedAt: new Date().toISOString(),
        environmentId: environment.id,
        config: { ...config },
        scenario: { ...scenario },
        expectedResponseHash: benchmark.expectedResponseHash,
        sourceHash: benchmark.sources[variant].sha256,
        warmup: emptyLoad(),
        load: emptyLoad(),
      };
      // Fixed executable and entrypoint, no shell, no inherited loaders or NODE_OPTIONS.
      const child = fork(
        fileURLToPath(new URL("./express-target.mjs", import.meta.url)),
        [variant],
        {
          execArgv: [],
          env: { NODE_ENV: "production", TZ: "UTC" },
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        },
      );
      const agent = new http.Agent({
        keepAlive: true,
        maxSockets: config.concurrency,
        maxFreeSockets: config.concurrency,
      });
      const deadline = setTimeout(() => child.kill("SIGKILL"), 120000);
      try {
        const ready = await nextMessage(child, "ready");
        run.warmup = await loadReference(
          ready.port,
          expected,
          config.warmupRequests,
          config,
          agent,
        );
        const begun = nextMessage(child, "begun");
        child.send({ type: "begin" });
        await begun;
        run.load = await loadReference(
          ready.port,
          expected,
          config.requests,
          config,
          agent,
        );
        const metrics = nextMessage(child, "metrics");
        child.send({ type: "end" });
        run.target = targetMetricsSchema.parse((await metrics).metrics);
        if (
          digest(
            await fs.readFile(path.join(sampleRoot, variant, "app.js")),
          ) !== run.sourceHash ||
          digest(
            await fs.readFile(path.join(sampleRoot, "reference-data.json")),
          ) !== benchmark.dataHash
        )
          run.error =
            "Sample source or data changed during the benchmark; comparison is invalid.";
      } catch {
        run.error =
          "The allowlisted sample failed, disconnected, or exceeded its deadline. Metrics may be incomplete.";
      } finally {
        clearTimeout(deadline);
        agent.destroy();
        await stop(child);
      }
      benchmark.runs.push(run);
      onProgress(
        `Pair ${pair + 1}/${config.pairs} · ${variant}: ${run.load.successful} successful, ${run.load.failed} failed${run.error ? " · incomplete" : ""}`,
      );
    }
  onStage("estimating");
  return benchmarkSchema.parse(benchmark);
}
export async function saveBenchmark(result: Benchmark) {
  const dataDir = path.resolve(
    process.env.GREEN_IT_DATA ?? path.join(root, ".data"),
  );
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  const temp = path.join(dataDir, `express-example-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(
      temp,
      JSON.stringify(benchmarkSchema.parse(result), null, 2),
      { mode: 0o600, flag: "wx" },
    );
    await fs.rename(temp, path.join(dataDir, "express-example.json"));
  } finally {
    await fs.rm(temp, { force: true });
  }
  return path.join(dataDir, "express-example.json");
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await runExpressBenchmark(
      parseBenchmarkArgs(process.argv.slice(2)),
      console.log,
    );
    const file = await saveBenchmark(result);
    const summary = summariseBenchmark(result);
    console.log(`Saved measured resources and scenario assumptions: ${file}`);
    console.log(
      summary.blocker ??
        `${summary.direction}: before ${summary.before.carbon!.mean} → after ${summary.after.carbon!.mean} gCO2e per 1000 successful requests (scenario, not measured emissions).`,
    );
    console.log("Open Airbus Green IT Insights → Express application example.");
    if (summary.blocker) process.exitCode = 1;
  } catch (e) {
    console.error(e instanceof Error ? e.message : "Benchmark failed");
    process.exitCode = 1;
  }
}

// The EcoLens journey reuses the existing fixed target process and cleanup helpers.
// It collects application HTTP body bytes; no compute-energy scenario is called.
export async function runTrafficJourney(
  workDir: string,
  onStage: (stage: string) => void = () => {},
) {
  const sample = path.join(root, "examples/ecolens-express");
  const manifest = JSON.parse(
    await fs.readFile(path.join(sample, "manifest.json"), "utf8"),
  ) as Record<string, string>;
  for (const [name, hash] of Object.entries(manifest)) {
    const file = path.join(sample, name);
    if (
      (await fs.lstat(file)).isSymbolicLink() ||
      (await fs.realpath(file)) !== file ||
      digest(await fs.readFile(file)) !== hash
    )
      throw Error("Trusted sample manifest mismatch");
  }
  const products = JSON.parse(
    await fs.readFile(path.join(sample, "products.json"), "utf8"),
  );
  const reference = JSON.parse(
    await fs.readFile(path.join(sample, "reference.json"), "utf8"),
  );
  const project = (p: any) => ({
    id: p.id,
    name: p.name,
    priceCents: p.priceCents,
    category: p.category,
  });
  const expectedProducts = products.map(project);
  const line = (id: number, quantity: number) => ({
    productId: id,
    name: products[id - 1].name,
    quantity,
    unitPriceCents: products[id - 1].priceCents,
    lineTotalCents: products[id - 1].priceCents * quantity,
  });
  const lines = [line(1, 2), line(3, 1)];
  const expectedOrder = {
    id: 1,
    status: "ready",
    currency: "EUR",
    lines,
    totalCents: lines.reduce((n, l) => n + l.lineTotalCents, 0),
  };
  const journeys: any[] = [];
  onStage("checking");
  const beforeCode = await fs.readFile(path.join(sample, "server.js"), "utf8");
  const afterCode = await fs.readFile(
    path.join(sample, "improved/server.js"),
    "utf8",
  );
  const { analyseCode } =
    await import("../packages/analysis-core/src/index.ts");
  const findings = analyseCode(beforeCode, "server.js");
  onStage("running");
  for (let pair = 0; pair < 3; pair++)
    for (const variant of pair % 2 === 0
      ? ["before", "after"]
      : ["after", "before"]) {
      const child = fork(
        fileURLToPath(new URL("./express-target.mjs", import.meta.url)),
        ["catalog-" + variant],
        {
          execArgv: [],
          env: {
            NODE_ENV: "production",
            TZ: "UTC",
            ECOLENS_SAMPLE_DB: path.join(workDir, `${pair}-${variant}.sqlite`),
          },
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        },
      );
      const deadline = setTimeout(() => child.kill("SIGKILL"), 15000);
      try {
        const { port, pid } = await nextMessage(child, "ready");
        const get = async (route: string) =>
          new Promise<{ body: any; bytes: number }>((resolve, reject) => {
            const req = http.get(
              {
                host: "127.0.0.1",
                port,
                path: route,
                headers: {
                  Accept: "application/json",
                  "Accept-Encoding": "identity",
                },
              },
              (res) => {
                const chunks: Buffer[] = [];
                let size = 0;
                res.on("data", (b: Buffer) => {
                  size += b.length;
                  if (size > 1024 * 1024)
                    res.destroy(Error("Sample response limit"));
                  else chunks.push(b);
                });
                res.on("error", reject);
                res.on("end", () => {
                  try {
                    if (
                      res.statusCode !== 200 ||
                      !String(res.headers["content-type"]).includes(
                        "application/json",
                      )
                    )
                      throw Error("Sample response failed");
                    resolve({
                      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
                      bytes: size,
                    });
                  } catch (e) {
                    reject(e);
                  }
                });
              },
            );
            req.setTimeout(3000, () =>
              req.destroy(Error("Sample request timeout")),
            );
            req.on("error", reject);
          });
        async function journey() {
          const entries: any[] = [];
          const observed: any[] = [];
          const read = async (route: string, label: string) => {
            const r = await get(route);
            entries.push({
              label,
              method: "GET",
              status: 200,
              bytes: r.bytes,
              reason: "included",
              field: "collected HTTP body",
            });
            return r.body;
          };
          for (let page = 1; page <= 3; page++) {
            const r = await read(
              `/products?page=${page}&limit=4`,
              `GET /products · page ${page}`,
            );
            if (
              r.page !== page ||
              r.limit !== 4 ||
              r.total !== 12 ||
              r.items.length !== 4
            )
              throw Error("Pagination task mismatch");
            observed.push(...r.items.map(project));
          }
          if (JSON.stringify(observed) !== JSON.stringify(expectedProducts))
            throw Error("Product task mismatch");
          const detail = await read("/products/1", "GET /products/:id");
          if (JSON.stringify(detail) !== JSON.stringify(products[0]))
            throw Error("Detail task mismatch");
          const ref = await read("/reference-data", "GET /reference-data");
          if (JSON.stringify(ref) !== JSON.stringify(reference))
            throw Error("Reference mismatch");
          const order = await read(
            "/orders/1/summary",
            "GET /orders/:id/summary",
          );
          if (JSON.stringify(order) !== JSON.stringify(expectedOrder))
            throw Error("Order task mismatch");
          const stock = await read("/availability/1", "GET /availability/:id");
          if (
            JSON.stringify(stock) !==
            JSON.stringify({
              productId: 1,
              available: 21,
              warehouse: "Synthetic central store",
            })
          )
            throw Error("Mock service mismatch");
          return entries;
        }
        await journey(); // Identical full warm-up journey, excluded from recorded evidence.
        const start = process.hrtime.bigint();
        const entries = await journey();
        journeys.push({
          variant,
          pair,
          pid,
          elapsedMs: Number(process.hrtime.bigint() - start) / 1e6,
          successful: entries.length,
          failed: 0,
          evidence: { kind: "sample", entries },
          taskEquivalent: true,
        });
      } finally {
        clearTimeout(deadline);
        await stop(child);
      }
    }
  for (const [name, hash] of Object.entries(manifest))
    if (digest(await fs.readFile(path.join(sample, name))) !== hash)
      throw Error("Sample changed during collection");
  return {
    journeys,
    findings,
    beforeCode,
    afterCode,
    manifest,
    config: {
      version: "catalog-journey/1.0",
      repetitions: 3,
      concurrency: 1,
      warmupJourneys: 1,
      requestsPerJourney: 7,
      task: "Read all 12 catalogue identities, names, prices and categories across 3 pages; inspect full product 1; read reference data, order 1 total/lines, and stock availability.",
      boundary:
        "Client-facing uncompressed HTTP response bodies only; excludes warm-up, headers, request bodies, transport overhead and internal mock-service hop. Localhost bytes used as a SWD reference scenario.",
    },
  };
}
