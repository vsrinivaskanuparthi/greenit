// Only these repository-owned sample modules can be executed. No paths or commands accepted.
const variant = process.argv[2];
if (
  process.argv.length !== 3 ||
  !["before", "after", "catalog-before", "catalog-after"].includes(variant) ||
  !process.send
) {
  process.stderr.write(
    "Only the allowlisted before/after benchmark samples are supported.\n",
  );
  process.exit(1);
}
const { lstat, realpath } = await import("node:fs/promises");
const { fileURLToPath } = await import("node:url");
const catalog = variant.startsWith("catalog-");
const file = new URL(
  catalog
    ? variant === "catalog-before"
      ? "../examples/ecolens-express/server.js"
      : "../examples/ecolens-express/improved/server.js"
    : `../examples/express-reference/${variant}/app.js`,
  import.meta.url,
);
if (
  (await lstat(file)).isSymbolicLink() ||
  (await realpath(file)) !== fileURLToPath(file)
)
  throw Error("Sample module must not be a symlink");
let app, sampleInstance, mockServer;
if (catalog) {
  const { createMockService } =
    await import("../examples/ecolens-express/mock-service.js");
  mockServer = createMockService().listen(0, "127.0.0.1");
  await new Promise((r) => mockServer.once("listening", r));
  const { createApplication } =
    variant === "catalog-before"
      ? await import("../examples/ecolens-express/server.js")
      : await import("../examples/ecolens-express/improved/server.js");
  sampleInstance = createApplication({
    databaseFile: process.env.ECOLENS_SAMPLE_DB,
    mockOrigin: `http://127.0.0.1:${mockServer.address().port}`,
  });
  app = sampleInstance.app;
} else
  app =
    variant === "before"
      ? (await import("../examples/express-reference/before/app.js")).default
      : (await import("../examples/express-reference/after/app.js")).default;
const server = app.listen(0, "127.0.0.1", () =>
  process.send({
    type: "ready",
    port: server.address().port,
    pid: process.pid,
  }),
);
let baseline, sampler;
process.on("message", (message) => {
  if (message?.type === "begin" && !baseline) {
    const memory = process.memoryUsage();
    baseline = {
      cpu: process.cpuUsage(),
      time: process.hrtime.bigint(),
      memory,
      peak: memory.rss,
      samples: 1,
    };
    sampler = setInterval(() => {
      baseline.peak = Math.max(baseline.peak, process.memoryUsage.rss());
      baseline.samples++;
    }, 50);
    process.send({ type: "begun" });
  } else if (message?.type === "end" && baseline) {
    const elapsedMs = Number(process.hrtime.bigint() - baseline.time) / 1e6;
    const cpu = process.cpuUsage(baseline.cpu);
    clearInterval(sampler);
    const memory = process.memoryUsage();
    process.send({
      type: "metrics",
      metrics: {
        processId: process.pid,
        elapsedMs,
        cpuUserMs: cpu.user / 1000,
        cpuSystemMs: cpu.system / 1000,
        rssStartBytes: baseline.memory.rss,
        rssEndBytes: memory.rss,
        sampledPeakRssBytes: Math.max(baseline.peak, memory.rss),
        heapUsedStartBytes: baseline.memory.heapUsed,
        heapUsedEndBytes: memory.heapUsed,
        lifetimeMaxRssKiB: process.resourceUsage().maxRSS,
        memorySamples: baseline.samples + 1,
      },
    });
    baseline = undefined;
  }
});
process.on("disconnect", () => {
  clearInterval(sampler);
  server.close();
  mockServer?.close();
  sampleInstance?.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  clearInterval(sampler);
  server.close();
  mockServer?.close();
  sampleInstance?.close();
  process.exit(0);
});
