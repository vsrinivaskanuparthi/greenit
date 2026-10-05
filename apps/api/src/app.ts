import { registerEco } from "./eco-api.ts";
import { registerExpressExample } from "./express-example.ts";
import { transfer } from "../../../packages/shared/src/carbon.ts";
import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  reportSchema,
  carbonSchema,
} from "../../../packages/shared/src/index.ts";
import type { Store, ScanRow } from "./store.ts";
import { limits } from "./archive.ts";
export function createApp(db: Store, tempDir: string) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const host = req.headers.host ?? "";
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
      res.status(403).json({ error: "Localhost access only" });
      return;
    }
    const origin = req.headers.origin;
    if (
      (origin && origin !== `http://${host}`) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      res.status(403).json({ error: "Cross-origin access rejected" });
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    next();
  });
  app.use(express.json({ limit: "12mb" }));
  registerExpressExample(app, path.dirname(tempDir), db);
  registerEco(app, db, tempDir);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limits.compressed, files: 1, fields: 4, parts: 5 },
  });
  let inflight = 0;
  app.use("/api", (req, res, next) => {
    if (req.method === "POST" && req.path === "/upload") {
      if (inflight >= 2) {
        res
          .status(429)
          .json({ error: "Upload capacity reached; retry shortly." });
        return;
      }
      inflight++;
      res.once("close", () => inflight--);
    }
    next();
  });
  const createProject = (name: string) => {
    const existing = db
      .prepare("SELECT id FROM projects WHERE name=?")
      .get(name) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = randomUUID();
    db.prepare("INSERT INTO projects VALUES (?,?,?)").run(
      id,
      name,
      new Date().toISOString(),
    );
    return id;
  };
  app.get("/api/projects", (_req, res) =>
    res.json(
      db.prepare("SELECT * FROM projects ORDER BY createdAt DESC").all(),
    ),
  );
  app.get("/api/scans", (_req, res) => {
    const rows = db
      .prepare("SELECT * FROM scans ORDER BY createdAt DESC")
      .all() as ScanRow[];
    res.json(
      rows.map((r) => {
        const report = r.report
          ? reportSchema.parse(JSON.parse(r.report))
          : null;
        return {
          ...r,
          report: undefined,
          findings: report?.findings.length,
          files: report?.coverage.analysed.length,
          coverage: report?.coverage.status,
          synthetic: report?.provenance.synthetic,
        };
      }),
    );
  });
  app.get("/api/scans/:id", (req, res) => {
    const row = db
      .prepare("SELECT * FROM scans WHERE id=?")
      .get(req.params.id) as ScanRow | undefined;
    if (!row) {
      res.status(404).json({ error: "Scan not found" });
      return;
    }
    const exampleJob = db
      .prepare(
        "SELECT id FROM express_jobs WHERE sourceScanId=? ORDER BY createdAt DESC LIMIT 1",
      )
      .get(row.id) as { id: string } | undefined;
    res.json({
      ...row,
      exampleJobId: exampleJob?.id,
      report: row.report ? JSON.parse(row.report) : null,
    });
  });
  app.get("/api/scans/:id/export", (req, res) => {
    const row = db
      .prepare("SELECT * FROM scans WHERE id=?")
      .get(req.params.id) as ScanRow | undefined;
    if (!row?.report) {
      res.status(404).json({ error: "Completed scan not found" });
      return;
    }
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="airbus-green-it-insights-${JSON.parse(row.report).provenance.synthetic ? "sample-data-" : ""}${row.id}.json"`,
    );
    res.type("json").send(row.report);
  });
  app.post("/api/import", (req, res) => {
    const input = z
      .object({
        projectName: z.string().trim().min(1).max(100),
        report: reportSchema,
      })
      .strict()
      .parse(req.body);
    const id = randomUUID();
    db.transaction(() => {
      const projectId = createProject(input.projectName);
      db.prepare(
        "INSERT INTO scans(id,projectId,status,origin,createdAt,report) VALUES (?,?,'completed','import',?,?)",
      ).run(
        id,
        projectId,
        new Date().toISOString(),
        JSON.stringify(input.report),
      );
    })();
    res.status(201).json({ id });
  });
  app.post("/api/upload", upload.single("archive"), async (req, res) => {
    const name = z.string().trim().min(1).max(100).parse(req.body.projectName);
    if (!req.file) throw new Error("A ZIP file is required");
    if (
      req.file.buffer.length < 4 ||
      req.file.buffer.readUInt32LE(0) !== 0x04034b50
    )
      throw new Error("Expected a non-empty ZIP archive");
    const pending = db
      .prepare(
        "SELECT COUNT(*) AS n FROM scans WHERE status IN ('queued','validating','analysing')",
      )
      .get() as { n: number };
    if (pending.n >= 20) {
      res
        .status(429)
        .json({ error: "Local queue full; wait for scans to complete." });
      return;
    }
    const id = randomUUID();
    const dir = path.join(tempDir, id);
    try {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(dir, "upload.zip"), req.file.buffer, {
        mode: 0o600,
        flag: "wx",
      });
      db.transaction(() => {
        const projectId = createProject(name);
        db.prepare(
          "INSERT INTO scans(id,projectId,status,origin,createdAt,synthetic) VALUES (?,?,'queued','zip',?,?)",
        ).run(
          id,
          projectId,
          new Date().toISOString(),
          req.body.synthetic === "true" ? 1 : 0,
        );
      })();
      res.status(202).json({ id });
    } catch (e) {
      await fs.rm(dir, { recursive: true, force: true });
      throw e;
    }
  });
  app.put("/api/scans/:id/carbon", (req, res) => {
    const carbon = carbonSchema.parse(req.body);
    if (carbon.transfer) transfer(carbon.transfer);
    const row = db
      .prepare("SELECT * FROM scans WHERE id=?")
      .get(req.params.id) as ScanRow | undefined;
    if (!row?.report) {
      res.status(404).json({ error: "Completed scan not found" });
      return;
    }
    const report = reportSchema.parse({ ...JSON.parse(row.report), carbon });
    db.prepare("UPDATE scans SET report=? WHERE id=?").run(
      JSON.stringify(report),
      row.id,
    );
    res.json(report);
  });
  app.delete("/api/projects/:id", async (req, res) => {
    const rows = db
      .prepare("SELECT * FROM scans WHERE projectId=?")
      .all(req.params.id) as ScanRow[];
    if (
      db
        .prepare(
          "SELECT e.id FROM express_jobs e JOIN scans s ON s.id=e.sourceScanId WHERE s.projectId=? AND e.status NOT IN ('completed','failed')",
        )
        .get(req.params.id)
    ) {
      res.status(409).json({
        error:
          "Wait for the sample workload to finish before deleting this project.",
      });
      return;
    }
    if (
      rows.some((r) => ["queued", "validating", "analysing"].includes(r.status))
    ) {
      res.status(409).json({
        error: "Wait for active scans to finish before deleting this project.",
      });
      return;
    }
    for (const r of rows)
      await fs.rm(path.join(tempDir, r.id), { recursive: true, force: true });
    const result = db
      .prepare("DELETE FROM projects WHERE id=?")
      .run(req.params.id);
    res.status(result.changes ? 204 : 404).end();
  });
  return app;
}
export const apiErrors: express.ErrorRequestHandler = (
  err,
  req,
  res,
  _next,
) => {
  const invalid = err instanceof z.ZodError;
  if (process.env.NODE_ENV !== "production")
    console.warn("[API rejected request]", {
      method: req.method,
      route: req.route?.path ?? "unmatched",
      kind: invalid
        ? "SchemaValidation"
        : err instanceof multer.MulterError
          ? "UploadLimit"
          : "InvalidRequest",
    });
  res.status(400).json({
    error: invalid
      ? "Invalid input or unsupported report schema. Check required fields, limits, and version."
      : err instanceof multer.MulterError
        ? "Upload rejected: file limit exceeded or unexpected multipart fields."
        : "Request failed. Check file format and input limits.",
  });
};
