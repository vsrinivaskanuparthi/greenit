import { z } from "zod";
import { reportSchema } from "./index.ts";
const number = z.number().finite().nonnegative();
const count = number.int();
const text = z.string().min(1).max(2000);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const benchmarkConfigSchema = z
  .object({
    requests: z.number().int().min(10).max(50000),
    concurrency: z.number().int().min(1).max(64),
    warmupRequests: z.number().int().min(10).max(5000),
    pairs: z.number().int().min(3).max(10),
    requestTimeoutMs: z.literal(5000),
    memorySampleIntervalMs: z.literal(50),
    endpoint: z.literal("/reference-data"),
    method: z.literal("GET"),
    order: z.literal("alternating-before-after"),
    connection: z.literal("HTTP/1.1 loopback keep-alive"),
  })
  .strict();
export type BenchmarkConfig = z.infer<typeof benchmarkConfigSchema>;
export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  requests: 10000,
  concurrency: 8,
  warmupRequests: 500,
  pairs: 6,
  requestTimeoutMs: 5000,
  memorySampleIntervalMs: 50,
  endpoint: "/reference-data",
  method: "GET",
  order: "alternating-before-after",
  connection: "HTTP/1.1 loopback keep-alive",
};
export const scenarioSchema = z
  .object({
    model: z.literal("fixed-allocation-time"),
    version: z.literal("1.0.0"),
    label: z.literal("Scenario-based operational carbon estimate"),
    allocatedPowerWatts: number.max(100000),
    powerProvenance: z.literal("illustrative assumption"),
    powerSource: text,
    carbonIntensityGramsPerKWh: number.max(100000),
    factorProvenance: z.literal("illustrative assumption"),
    factorSource: text,
    factorDate: text,
    factorRegion: text,
    boundary: text,
    functionalUnit: z.literal("1000 successful GET /reference-data requests"),
    exclusions: z.array(text).min(1).max(20),
    formulaSource: text,
    formulaNote: text,
  })
  .strict();
export type Scenario = z.infer<typeof scenarioSchema>;
export const workloadMetricsSchema = z
  .object({
    attempted: count,
    successful: count,
    failed: count,
    invalidResponses: count,
    networkErrors: count,
    payloadBytes: count,
    successfulPayloadBytes: count,
    elapsedMs: number,
    cpuUserMs: number,
    cpuSystemMs: number,
  })
  .strict()
  .refine(
    (v) =>
      v.attempted === v.successful + v.failed &&
      v.failed === v.invalidResponses + v.networkErrors,
    "Request counts must reconcile",
  );
export type WorkloadMetrics = z.infer<typeof workloadMetricsSchema>;
export const targetMetricsSchema = z
  .object({
    processId: count,
    elapsedMs: number,
    cpuUserMs: number,
    cpuSystemMs: number,
    rssStartBytes: count,
    rssEndBytes: count,
    sampledPeakRssBytes: count,
    heapUsedStartBytes: count,
    heapUsedEndBytes: count,
    lifetimeMaxRssKiB: count,
    memorySamples: count,
  })
  .strict();
export type TargetMetrics = z.infer<typeof targetMetricsSchema>;
export const benchmarkRunSchema = z
  .object({
    variant: z.enum(["before", "after"]),
    pair: z.number().int().nonnegative(),
    position: z.enum(["first", "second"]),
    startedAt: z.string().datetime(),
    environmentId: hash,
    config: benchmarkConfigSchema,
    scenario: scenarioSchema,
    expectedResponseHash: hash,
    sourceHash: hash,
    warmup: workloadMetricsSchema,
    load: workloadMetricsSchema,
    target: targetMetricsSchema.optional(),
    error: z.string().max(2000).optional(),
  })
  .strict();
export type BenchmarkRun = z.infer<typeof benchmarkRunSchema>;
export const benchmarkSchema = z
  .object({
    schemaVersion: z.literal("express-benchmark/1.0"),
    createdAt: z.string().datetime(),
    label: z.literal("Sample application"),
    provenance: z
      .object({
        resources: z.literal("measured locally"),
        energy: z.literal("scenario model; not measured"),
        businessData: z.literal("synthetic"),
        execution: z.literal("allowlisted repository samples only"),
      })
      .strict(),
    environment: z
      .object({
        id: hash,
        node: text,
        express: text,
        platform: text,
        release: text,
        arch: text,
        cpuModel: text,
        logicalCpus: count,
        totalMemoryBytes: count,
        instrumentationVersion: z.literal("1.0.0"),
        energyCapability: text,
        measurementBoundary: text,
        limitations: z.array(text).min(1).max(20),
      })
      .strict(),
    config: benchmarkConfigSchema,
    scenario: scenarioSchema,
    dataHash: hash,
    expectedResponseHash: hash,
    responsePayloadBytes: count,
    sources: z
      .object({
        before: z
          .object({
            file: z.literal("examples/express-reference/before/app.js"),
            sha256: hash,
            code: z.string().max(10000),
            scan: reportSchema,
          })
          .strict(),
        after: z
          .object({
            file: z.literal("examples/express-reference/after/app.js"),
            sha256: hash,
            code: z.string().max(10000),
            scan: reportSchema,
          })
          .strict(),
      })
      .strict(),
    runs: z.array(benchmarkRunSchema).max(20),
  })
  .strict();
export type Benchmark = z.infer<typeof benchmarkSchema>;
export function scenarioEstimate(
  elapsedMs: number,
  successful: number,
  input: Scenario,
) {
  const s = scenarioSchema.parse(input);
  number.parse(elapsedMs);
  count.parse(successful);
  const kWh = (s.allocatedPowerWatts * (elapsedMs / 1000)) / 3600000;
  const grams = kWh * s.carbonIntensityGramsPerKWh;
  return {
    kWh,
    grams,
    gramsPer1000: successful > 0 ? (grams * 1000) / successful : null,
  };
}
export function stats(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((n, v) => n + v, 0) / values.length;
  return {
    mean,
    median:
      (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.floor(sorted.length / 2)]) /
      2,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    standardDeviation: Math.sqrt(
      values.reduce((n, v) => n + (v - mean) ** 2, 0) / values.length,
    ),
    count: values.length,
  };
}
export function comparisonBlocker(b: Benchmark): string | null {
  if (b.runs.length !== b.config.pairs * 2)
    return "Missing runs: both versions need every configured repetition.";
  for (let pair = 0; pair < b.config.pairs; pair++)
    for (const variant of ["before", "after"] as const) {
      const matches = b.runs.filter(
        (r) => r.pair === pair && r.variant === variant,
      );
      if (matches.length !== 1)
        return "Missing or duplicate run pair; comparison is unavailable.";
      const r = matches[0];
      if (r.error || !r.target)
        return "A benchmark run did not complete. No improvement comparison is shown.";
      if (
        r.load.failed ||
        r.warmup.failed ||
        r.load.successful !== b.config.requests ||
        r.warmup.successful !== b.config.warmupRequests
      )
        return "Failed or incomplete requests make this comparison misleading. Rerun before comparing.";
      if (
        r.environmentId !== b.environment.id ||
        JSON.stringify(r.config) !== JSON.stringify(b.config) ||
        JSON.stringify(r.scenario) !== JSON.stringify(b.scenario) ||
        r.expectedResponseHash !== b.expectedResponseHash ||
        r.sourceHash !== b.sources[variant].sha256
      )
        return "Run configurations, response validation, sources, environment or model assumptions differ.";
      if (
        r.position !==
        (variant === (pair % 2 === 0 ? "before" : "after") ? "first" : "second")
      )
        return "Run order does not match the controlled alternating procedure.";
      if (
        r.load.successfulPayloadBytes !==
        b.responsePayloadBytes * r.load.successful
      )
        return "Validated response bytes do not match the declared workload.";
    }
  return null;
}
export function summariseBenchmark(b: Benchmark) {
  const summaries = Object.fromEntries(
    (["before", "after"] as const).map((variant) => {
      const runs = b.runs.filter((r) => r.variant === variant);
      const values = runs
        .filter((r) => r.target && !r.error && r.load.successful > 0)
        .map(
          (r) =>
            scenarioEstimate(r.target!.elapsedMs, r.load.successful, r.scenario)
              .gramsPer1000!,
        );
      return [
        variant,
        {
          carbon: stats(values),
          successful: runs.reduce((n, r) => n + r.load.successful, 0),
          failed: runs.reduce((n, r) => n + r.load.failed, 0),
          warmupFailures: runs.reduce((n, r) => n + r.warmup.failed, 0),
          runs: runs.length,
        },
      ];
    }),
  ) as Record<
    "before" | "after",
    {
      carbon: ReturnType<typeof stats>;
      successful: number;
      failed: number;
      warmupFailures: number;
      runs: number;
    }
  >;
  const blocker = comparisonBlocker(b);
  const before = summaries.before.carbon?.mean,
    after = summaries.after.carbon?.mean;
  const difference =
    blocker || before === undefined || after === undefined
      ? null
      : after - before;
  const percentage =
    difference === null || before === undefined || before === 0
      ? null
      : (difference / before) * 100;
  return {
    ...summaries,
    blocker,
    difference,
    percentage,
    direction:
      difference === null
        ? null
        : difference < 0
          ? "Lower estimate"
          : difference > 0
            ? "Higher estimate"
            : "Same estimate",
  };
}
