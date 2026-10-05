import { z } from "zod";
import type { Store } from "./store.ts";
import { sampleRoot, verifySample, enqueueExample } from "./express-sample.ts";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Express } from "express";
import { benchmarkSchema } from "../../../packages/shared/src/benchmark.ts";
// The only execution action queues the fixed trusted sample; no source paths or workload arguments.
export function registerExpressExample(
  app: Express,
  dataDir: string,
  db: Store,
) {
  app.get("/api/examples/express/source", async (_req, res) => {
    if (!(await verifySample())) {
      res.status(409).json({
        error:
          "Bundled sample differs from its manifest. Restore the trusted example before analysing.",
      });
      return;
    }
    res.json({
      before: await fs.readFile(path.join(sampleRoot, "before/app.js"), "utf8"),
      after: await fs.readFile(path.join(sampleRoot, "after/app.js"), "utf8"),
    });
  });
  app.get("/api/examples/express/sample.zip", async (_req, res) => {
    if (!(await verifySample())) {
      res.status(409).json({ error: "Bundled sample verification failed." });
      return;
    }
    res.download(
      path.resolve(sampleRoot, "../generated/express-reference.zip"),
      "express-reference.zip",
    );
  });
  app.post("/api/examples/express/analyse", (req, res) => {
    z.object({ sample: z.literal("express-reference-v1") })
      .strict()
      .parse(req.body);
    try {
      const id = enqueueExample(db);
      res.status(202).json({ id });
    } catch {
      res.status(409).json({
        error:
          "An Express analysis is already running. Open Results/comparison to follow it.",
      });
    }
  });
  async function read() {
    const file = path.join(dataDir, "express-example.json");
    try {
      const stat = await fs.lstat(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > 2 * 1024 * 1024
      )
        throw new Error("Invalid benchmark file");
      return benchmarkSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  app.get("/api/examples/express", async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      const jobs = db
        .prepare(
          "SELECT id,status,createdAt,updatedAt,error,sourceScanId,history FROM express_jobs ORDER BY createdAt DESC",
        )
        .all();
      const requested =
        typeof _req.query.job === "string" ? _req.query.job : undefined;
      const row = (
        requested
          ? db.prepare("SELECT * FROM express_jobs WHERE id=?").get(requested)
          : db
              .prepare(
                "SELECT * FROM express_jobs ORDER BY createdAt DESC LIMIT 1",
              )
              .get()
      ) as any;
      if (requested && !row) {
        res.status(404).json({ error: "Example result not found" });
        return;
      }
      res.json({
        benchmark: row
          ? row.result
            ? benchmarkSchema.parse(JSON.parse(row.result))
            : null
          : await read(),
        job: row
          ? { ...row, result: undefined, history: JSON.parse(row.history) }
          : null,
        jobs,
      });
    } catch {
      res.status(422).json({
        error:
          "The saved Express benchmark is invalid or incomplete. Retry Analyse Express example to regenerate it.",
      });
    }
  });
  app.get("/api/examples/express/export", async (_req, res) => {
    try {
      const row = (
        typeof _req.query.job === "string"
          ? db
              .prepare("SELECT result FROM express_jobs WHERE id=?")
              .get(_req.query.job)
          : db
              .prepare(
                "SELECT result FROM express_jobs WHERE status='completed' ORDER BY createdAt DESC LIMIT 1",
              )
              .get()
      ) as { result: string } | undefined;
      if (typeof _req.query.job === "string" && !row?.result) {
        res
          .status(404)
          .json({ error: "No stored result for this example analysis." });
        return;
      }
      const benchmark = row?.result
        ? benchmarkSchema.parse(JSON.parse(row.result))
        : await read();
      if (!benchmark) {
        res.status(404).json({ error: "Analyse the Express example first." });
        return;
      }
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="airbus-express-sample-benchmark.json"',
      );
      res.json(benchmark);
    } catch {
      res
        .status(422)
        .json({ error: "The saved Express benchmark could not be validated." });
    }
  });
}
