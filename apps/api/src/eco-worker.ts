import { promises as fs } from "node:fs";
import path from "node:path";
import { openStore } from "./store.ts";
import { extractZip } from "./archive.ts";
import { scan } from "../../../packages/analysis-core/src/index.ts";
import { runTrafficJourney } from "../../../scripts/express-benchmark.ts";
import { estimateTraffic } from "./traffic.ts";
const [dataDir, tempDir, id] = process.argv.slice(2),
  db = openStore(dataDir),
  dir = path.join(tempDir, id);
const stopTree = () => {
  if (process.platform !== "win32") {
    try {
      process.kill(0, "SIGKILL");
    } catch {
      process.exit(1);
    }
  } else process.exit(1);
};
const timer = setTimeout(stopTree, 90000);
process.once("disconnect", stopTree);
const stage = (s: string) =>
  db.prepare("UPDATE eco_reports SET status=? WHERE id=?").run(s, id);
try {
  const row = db.prepare("SELECT * FROM eco_reports WHERE id=?").get(id) as any;
  stage("reading");
  let result: any = {
    schemaVersion: "ecolens/1.0",
    createdAt: new Date().toISOString(),
    kind: row.kind,
    source: null,
    traffic: row.traffic ? estimateTraffic(JSON.parse(row.traffic)) : null,
  };
  if (row.kind === "sample") {
    const sample = await runTrafficJourney(dir, stage);
    stage("estimating");
    const before = sample.journeys
      .filter((j) => j.variant === "before")
      .map((j) => estimateTraffic(j.evidence));
    const after = sample.journeys
      .filter((j) => j.variant === "after")
      .map((j) => estimateTraffic(j.evidence));
    result.sample = { ...sample, before, after };
    result.traffic = before[0];
  } else if (row.sourceName) {
    let source = path.join(dir, "source");
    if (row.sourceName === "upload.zip") {
      await extractZip(path.join(dir, "upload.zip"), source);
      const entries = await fs.readdir(source, { withFileTypes: true });
      if (entries.length === 1 && entries[0].isDirectory())
        source = path.join(source, entries[0].name);
    }
    stage("checking");
    result.source = await scan(source, { origin: "zip", maxMs: 30000 });
    stage("estimating");
  }
  db.prepare(
    "UPDATE eco_reports SET status='completed',result=?,traffic=NULL WHERE id=?",
  ).run(JSON.stringify(result), id);
} catch {
  db.prepare(
    "UPDATE eco_reports SET status='failed',error=?,traffic=NULL WHERE id=?",
  ).run(
    "Analysis could not complete. Check the file format and limits, then try again. The sample requires its unchanged bundled files and local services.",
    id,
  );
} finally {
  clearTimeout(timer);
  process.removeListener("disconnect", stopTree);
  await fs.rm(dir, { recursive: true, force: true });
  db.close();
}
