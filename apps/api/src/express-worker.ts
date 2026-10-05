import { runExpressBenchmark } from "../../../scripts/express-benchmark.ts";
import {
  DEFAULT_BENCHMARK_CONFIG,
  summariseBenchmark,
} from "../../../packages/shared/src/benchmark.ts";
import { openStore } from "./store.ts";
import { verifySample, setExampleStage } from "./express-sample.ts";
const [dataDir, id] = process.argv.slice(2);
const db = openStore(dataDir);
const stopTree = () => {
  if (process.platform !== "win32") {
    try {
      process.kill(0, "SIGKILL");
    } catch {
      process.exit(1);
    }
  } else process.exit(1);
};
const watchdog = setTimeout(stopTree, 90000);
process.once("disconnect", stopTree);
// Only the scheduler supplies these arguments. No uploaded path reaches the benchmark.
try {
  setExampleStage(db, id, "reading");
  if (!(await verifySample())) throw new Error("Sample manifest mismatch");
  const result = await runExpressBenchmark(
    DEFAULT_BENCHMARK_CONFIG,
    () => {},
    (stage) => setExampleStage(db, id, stage),
  );
  // Calculate and validate before committing; the UI uses the same versioned functions.
  const summary = summariseBenchmark(result);
  if (summary.blocker) {
    db.prepare("UPDATE express_jobs SET result=? WHERE id=?").run(
      JSON.stringify(result),
      id,
    );
    setExampleStage(db, id, "failed", summary.blocker);
  } else {
    db.prepare("UPDATE express_jobs SET result=? WHERE id=?").run(
      JSON.stringify(result),
      id,
    );
    setExampleStage(db, id, "completed");
  }
} catch {
  setExampleStage(
    db,
    id,
    "failed",
    "The trusted sample could not complete. Its files may have changed, or the workload failed. Retry analysis; check the bundled manifest if this persists.",
  );
} finally {
  clearTimeout(watchdog);
  process.removeListener("disconnect", stopTree);
  db.close();
}
