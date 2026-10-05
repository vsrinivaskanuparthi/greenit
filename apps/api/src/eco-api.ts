import type { Express } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { z } from "zod";
import type { Store } from "./store.ts";
import { readHar } from "./traffic.ts";
import { modelInfo } from "../../../packages/shared/src/traffic.ts";
const root = fileURLToPath(new URL("../../../", import.meta.url));
export function registerEco(app: Express, db: Store, tempDir: string) {
  const require = createRequire(import.meta.url);
  app.get("/api/eco/info", (_req, res) =>
    res.json({
      parser: {
        package: "@babel/parser",
        version: require("@babel/parser/package.json").version,
      },
      traverseVersion: require("@babel/traverse/package.json").version,
      model: modelInfo,
    }),
  );
  app.get("/api/eco/server.js", (_req, res) =>
    res.download(
      path.join(root, "examples/ecolens-express/server.js"),
      "server.js",
    ),
  );
  app.get("/api/eco/example.zip", (_req, res) =>
    res.download(
      path.join(root, "examples/generated/ecolens-express.zip"),
      "ecolens-express.zip",
    ),
  );
  app.get("/api/eco/results", (_req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,kind,status,createdAt FROM eco_reports ORDER BY createdAt DESC LIMIT 100",
        )
        .all(),
    ),
  );
  app.get("/api/eco/results/:id", (req, res) => {
    const r = db
      .prepare(
        "SELECT id,kind,status,createdAt,result,error FROM eco_reports WHERE id=?",
      )
      .get(req.params.id) as any;
    if (!r) {
      res.status(404).json({ error: "Result not found." });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...r, result: r.result ? JSON.parse(r.result) : null });
  });
  app.get("/api/eco/results/:id/export", (req, res) => {
    const r = db
      .prepare("SELECT result FROM eco_reports WHERE id=?")
      .get(req.params.id) as any;
    if (!r?.result) {
      res.status(404).json({ error: "No completed result." });
      return;
    }
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="ecolens-airbus-report.json"',
    );
    res.type("json").send(r.result);
  });
  const capacity = () => {
    const n = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM eco_reports WHERE status NOT IN ('completed','failed')",
        )
        .get() as any
    ).n;
    if (n >= 10) throw Error("Analysis queue full");
  };
  app.post("/api/eco/example", async (req, res) => {
    z.object({}).strict().parse(req.body);
    capacity();
    if (
      db
        .prepare(
          "SELECT id FROM eco_reports WHERE kind='sample' AND status NOT IN ('completed','failed')",
        )
        .get()
    ) {
      res
        .status(409)
        .json({
          error:
            "The example is already running. Reopen it under saved results.",
        });
      return;
    }
    const id = randomUUID();
    await fs.mkdir(path.join(tempDir, id), { recursive: true, mode: 0o700 });
    db.prepare(
      "INSERT INTO eco_reports(id,kind,status,createdAt) VALUES(?,?,?,?)",
    ).run(id, "sample", "queued", new Date().toISOString());
    res.status(202).json({ id });
  });
  let inflight = 0;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 2, fields: 0, parts: 2 },
  }).fields([
    { name: "source", maxCount: 1 },
    { name: "har", maxCount: 1 },
  ]);
  app.post(
    "/api/eco/analyse",
    (req, res, next) => {
      if (inflight >= 2) {
        res
          .status(429)
          .json({ error: "Upload capacity reached. Retry shortly." });
        return;
      }
      inflight++;
      res.once("close", () => inflight--);
      next();
    },
    upload,
    async (req, res) => {
      capacity();
      const files = req.files as Record<string, Express.Multer.File[]>;
      const source = files?.source?.[0],
        har = files?.har?.[0];
      if (!source && !har) throw Error("Choose source or HAR");
      let traffic = null;
      if (har) {
        if (!har.originalname.toLowerCase().endsWith(".har"))
          throw Error("HAR required");
        try {
          traffic = readHar(
            JSON.parse(har.buffer.toString("utf8").replace(/^\uFEFF/, "")),
          );
        } catch {
          res
            .status(400)
            .json({
              error:
                "Invalid HAR. Use HAR 1.1/1.2 JSON with at most 5,000 entries (10 MiB maximum).",
            });
          return;
        }
      }
      let name: string | null = null;
      if (source) {
        const ext = path.extname(source.originalname).toLowerCase();
        if (![".js", ".ts", ".jsx", ".tsx", ".zip"].includes(ext))
          throw Error("Unsupported source");
        if (ext !== ".zip" && source.size > 1024 * 1024) {
          res
            .status(400)
            .json({
              error: "Single source files must be no larger than 1 MiB.",
            });
          return;
        }
        name =
          ext === ".zip"
            ? "upload.zip"
            : /^[a-zA-Z0-9_.-]{1,100}$/.test(source.originalname) &&
                !source.originalname.startsWith(".")
              ? source.originalname
              : "source" + ext;
      }
      const id = randomUUID(),
        dir = path.join(tempDir, id);
      try {
        await fs.mkdir(path.join(dir, "source"), {
          recursive: true,
          mode: 0o700,
        });
        if (source)
          await fs.writeFile(
            path.join(
              dir,
              name === "upload.zip" ? "upload.zip" : "source/" + name,
            ),
            source.buffer,
            { mode: 0o600, flag: "wx" },
          );
        db.prepare(
          "INSERT INTO eco_reports(id,kind,status,createdAt,sourceName,traffic) VALUES(?,?,?,?,?,?)",
        ).run(
          id,
          "upload",
          "queued",
          new Date().toISOString(),
          name,
          traffic ? JSON.stringify(traffic) : null,
        );
        res.status(202).json({ id });
      } catch (e) {
        await fs.rm(dir, { recursive: true, force: true });
        throw e;
      }
    },
  );
}
