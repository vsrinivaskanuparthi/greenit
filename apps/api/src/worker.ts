import { verifySample, enqueueExample } from "./express-sample.ts";
import { extractZip } from "./archive.ts";
import { scan } from "../../../packages/analysis-core/src/index.ts";
import { openStore } from "./store.ts";
import { promises as fs } from "node:fs";
import path from "node:path";
const [dataDir, tempDir, id] = process.argv.slice(2);
const job = path.join(tempDir, id);
const db = openStore(dataDir);
try {
  db.prepare("UPDATE scans SET status='validating' WHERE id=?").run(id);
  await extractZip(path.join(job, "upload.zip"), path.join(job, "source"));
  db.prepare("UPDATE scans SET status='analysing' WHERE id=?").run(id);
  const root = path.join(job, "source");
  const entries = await fs.readdir(root, { withFileTypes: true });
  const actual =
    entries.length === 1 && entries[0].isDirectory()
      ? path.join(root, entries[0].name)
      : root;
  const recognised = await verifySample(actual).catch(() => false);
  const report = await scan(actual, {
    origin: "zip",
    synthetic: recognised || process.argv[5] === "synthetic",
    maxMs: 30000,
  });
  db.transaction(() => {
    db.prepare("UPDATE scans SET status='completed',report=? WHERE id=?").run(
      JSON.stringify(report),
      id,
    );
    if (recognised) enqueueExample(db, id);
  })();
} catch {
  db.prepare("UPDATE scans SET status='failed',error=? WHERE id=?").run(
    "Archive rejected or analysis failed. Check ZIP paths, file limits and supported syntax; see help for limits.",
    id,
  );
} finally {
  await fs.rm(job, { recursive: true, force: true });
  db.close();
}
