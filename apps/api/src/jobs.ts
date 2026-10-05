import { setExampleStage } from "./express-sample.ts";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { Store, ScanRow } from "./store.ts";
export async function startJobs(
  db: Store,
  dataDir: string,
  tempDir: string,
  options: { benchmarkDeadlineMs?: number } = {},
) {
  await fs.mkdir(tempDir, { recursive: true, mode: 0o700 });
  await fs.chmod(tempDir, 0o700);
  db.prepare(
    "UPDATE scans SET status='failed',error='Interrupted by application restart; upload again.' WHERE status IN ('queued','validating','analysing')",
  ).run();
  for (const name of await fs.readdir(tempDir))
    await fs.rm(path.join(tempDir, name), { recursive: true, force: true });
  for (const row of db
    .prepare(
      "SELECT id FROM express_jobs WHERE status NOT IN ('completed','failed')",
    )
    .all() as { id: string }[])
    setExampleStage(
      db,
      row.id,
      "failed",
      "Interrupted by application restart. Retry analysis.",
    );
  db.prepare(
    "UPDATE eco_reports SET status='failed',traffic=NULL,error='Interrupted by restart. Retry the analysis.' WHERE status NOT IN ('completed','failed')",
  ).run();
  let active:
    { id: string; child: ChildProcess; benchmark?: boolean } | undefined;
  const kill = (child: ChildProcess, benchmark = false) => {
    try {
      if (benchmark && process.platform !== "win32" && child.pid)
        process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      /* already exited */
    }
  };
  let stopped = false;
  let busy = false;
  const timer = setInterval(async () => {
    if (stopped || busy || active) return;
    busy = true;
    try {
      const eco = db
        .prepare(
          "SELECT id FROM eco_reports WHERE status='queued' ORDER BY createdAt LIMIT 1",
        )
        .get() as { id: string } | undefined;
      if (eco) {
        const child = fork(
          fileURLToPath(new URL("./eco-worker.ts", import.meta.url)),
          [dataDir, tempDir, eco.id],
          {
            execArgv: ["--max-old-space-size=384", "--import", "tsx"],
            stdio: "ignore",
            detached: process.platform !== "win32",
          },
        );
        active = { id: eco.id, child, benchmark: true };
        const timeout = setTimeout(
          () => kill(child, true),
          options.benchmarkDeadlineMs ?? 90000,
        );
        const finish = () => {
          clearTimeout(timeout);
          kill(child, true);
          db.prepare(
            "UPDATE eco_reports SET status='failed',traffic=NULL,error='Worker interrupted or exceeded its time limit. Retry analysis.' WHERE id=? AND status NOT IN ('completed','failed')",
          ).run(eco.id);
          void fs
            .rm(path.join(tempDir, eco.id), { recursive: true, force: true })
            .finally(() => {
              active = undefined;
            });
        };
        child.once("exit", finish);
        child.once("error", () => {
          kill(child, true);
          if (!child.pid) finish();
        });
        return;
      }
      const row = db
        .prepare(
          "SELECT * FROM scans WHERE status='queued' ORDER BY createdAt LIMIT 1",
        )
        .get() as ScanRow | undefined;
      if (!row) {
        const example = db
          .prepare(
            "SELECT id FROM express_jobs WHERE status='queued' ORDER BY createdAt LIMIT 1",
          )
          .get() as { id: string } | undefined;
        if (!example) return;
        const child = fork(
          fileURLToPath(new URL("./express-worker.ts", import.meta.url)),
          [dataDir, example.id],
          {
            execArgv: ["--max-old-space-size=384", "--import", "tsx"],
            stdio: "ignore",
            detached: process.platform !== "win32",
          },
        );
        active = { id: example.id, child, benchmark: true };
        const timeout = setTimeout(
          () => kill(child, true),
          options.benchmarkDeadlineMs ?? 90000,
        );
        const finish = () => {
          clearTimeout(timeout);
          kill(child, true);
          const state = db
            .prepare("SELECT status FROM express_jobs WHERE id=?")
            .get(example.id) as { status: string } | undefined;
          if (state && !["completed", "failed"].includes(state.status))
            setExampleStage(
              db,
              example.id,
              "failed",
              "Sample worker interrupted or exceeded its 90-second limit. Retry analysis.",
            );
          active = undefined;
        };
        child.once("exit", finish);
        child.once("error", () => {
          kill(child, true);
          if (!child.pid) finish();
        });
        return;
      }
      const child = fork(
        fileURLToPath(new URL("./worker.ts", import.meta.url)),
        [dataDir, tempDir, row.id, row.synthetic === 1 ? "synthetic" : ""],
        {
          execArgv: ["--max-old-space-size=256", "--import", "tsx"],
          stdio: "ignore",
        },
      );
      active = { id: row.id, child };
      const timeout = setTimeout(() => child.kill("SIGKILL"), 45000);
      child.on("error", () => child.kill());
      child.on("exit", () => {
        clearTimeout(timeout);
        void (async () => {
          try {
            await fs.rm(path.join(tempDir, row.id), {
              recursive: true,
              force: true,
            });
            if (!stopped)
              db.prepare(
                "UPDATE scans SET status='failed',error='Worker interrupted or exceeded 45 second limit.' WHERE id=? AND status != 'completed' AND status != 'failed'",
              ).run(row.id);
          } finally {
            active = undefined;
          }
        })();
      });
    } finally {
      busy = false;
    }
  }, 250);
  return {
    activeProcess: () => active?.child.pid,
    isActive: (ids: string[]) => !!active && ids.includes(active.id),
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      if (active) {
        const c = active.child;
        await new Promise<void>((r) => {
          c.once("exit", () => r());
          kill(c, active?.benchmark);
        });
      }
      await fs.rm(tempDir, { recursive: true, force: true });
    },
  };
}
