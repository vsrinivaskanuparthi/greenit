import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Store } from "./store.ts";
export const sampleRoot = fileURLToPath(
  new URL("../../../examples/express-reference/", import.meta.url),
);
export const digest = (b: Buffer | string) =>
  createHash("sha256").update(b).digest("hex");
export const activeStages = [
  "queued",
  "reading",
  "checking",
  "running",
  "estimating",
];
export async function verifySample(root = sampleRoot) {
  const manifest = JSON.parse(
    await fs.readFile(path.join(sampleRoot, "manifest.json"), "utf8"),
  ) as Record<string, string>;
  const seen: string[] = [];
  async function walk(dir: string, prefix = "") {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (root === sampleRoot && relative === "manifest.json") continue;
      if (entry.isSymbolicLink()) return false;
      if (entry.isDirectory()) {
        if (!(await walk(path.join(dir, entry.name), relative + "/")))
          return false;
      } else if (entry.isFile()) {
        if (
          !Object.hasOwn(manifest, relative) ||
          digest(await fs.readFile(path.join(dir, entry.name))) !==
            manifest[relative]
        )
          return false;
        seen.push(relative);
      } else return false;
    }
    return true;
  }
  return (await walk(root)) && seen.length === Object.keys(manifest).length;
}
export function enqueueExample(db: Store, sourceScanId: string | null = null) {
  const current = db
    .prepare(
      "SELECT id FROM express_jobs WHERE status NOT IN ('completed','failed') LIMIT 1",
    )
    .get() as { id: string } | undefined;
  if (current && !sourceScanId)
    throw new Error("Example analysis already active");
  const id = randomUUID(),
    now = new Date().toISOString();
  db.prepare(
    "INSERT INTO express_jobs(id,status,createdAt,updatedAt,sourceScanId,history) VALUES(?,?,?,?,?,?)",
  ).run(
    id,
    "queued",
    now,
    now,
    sourceScanId,
    JSON.stringify([{ stage: "queued", at: now }]),
  );
  return id;
}
export function setExampleStage(
  db: Store,
  id: string,
  status: string,
  error: string | null = null,
) {
  const row = db
    .prepare("SELECT history FROM express_jobs WHERE id=?")
    .get(id) as { history: string } | undefined;
  if (!row) return;
  const now = new Date().toISOString();
  const history = JSON.parse(row.history);
  history.push({ stage: status, at: now });
  db.prepare(
    "UPDATE express_jobs SET status=?,updatedAt=?,error=?,history=? WHERE id=?",
  ).run(status, now, error, JSON.stringify(history), id);
}
