import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { once } from "node:events";
import { openStore } from "../apps/api/src/store.ts";
import { createApp, apiErrors } from "../apps/api/src/app.ts";
import { startJobs } from "../apps/api/src/jobs.ts";
import {
  verifySample,
  sampleRoot,
  enqueueExample,
} from "../apps/api/src/express-sample.ts";
import { extractZip } from "../apps/api/src/archive.ts";
async function until(check: () => boolean, ms = 10000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw Error("Timeout");
    await new Promise((r) => setTimeout(r, 40));
  }
}
test("exact sample manifest rejects edits, additional files and symlinks; ZIP contents match", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "manifest-check-"));
  try {
    assert.equal(await verifySample(), true);
    await extractZip("examples/generated/express-reference.zip", dir);
    assert.equal(await verifySample(dir), true);
    await fs.appendFile(path.join(dir, "before/app.js"), "\n// modified\n");
    assert.equal(await verifySample(dir), false);
    await fs.copyFile(
      path.join(sampleRoot, "before/app.js"),
      path.join(dir, "before/app.js"),
    );
    await fs.writeFile(
      path.join(dir, "package.json"),
      '{"name":"express-reference-v1"}',
    );
    assert.equal(await verifySample(dir), false);
    await fs.rm(path.join(dir, "package.json"));
    await fs.rm(path.join(dir, "before/app.js"));
    await fs.symlink(
      path.join(sampleRoot, "before/app.js"),
      path.join(dir, "before/app.js"),
    );
    assert.equal(await verifySample(dir), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test("browser benchmark queue is strict and single-flight; timeout kills process group, restart marks interrupted", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sample-job-"));
  const db = openStore(dir),
    temp = path.join(dir, "temporary");
  let jobs = await startJobs(db, dir, temp, { benchmarkDeadlineMs: 1200 });
  const app = createApp(db, temp);
  app.use(apiErrors);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = (body: unknown, origin?: string) =>
    fetch(base + "/api/examples/express/analyse", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (
        await post({
          sample: "express-reference-v1",
          path: "/tmp/upload/app.js",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          { sample: "express-reference-v1" },
          "https://attacker.invalid",
        )
      ).status,
      403,
    );
    const response = await post({ sample: "express-reference-v1" });
    assert.equal(response.status, 202);
    const { id } = (await response.json()) as { id: string };
    assert.equal((await post({ sample: "express-reference-v1" })).status, 409);
    await until(() => !!jobs.activeProcess());
    const pid = jobs.activeProcess()!;
    await until(
      () =>
        (
          db
            .prepare("SELECT status FROM express_jobs WHERE id=?")
            .get(id) as any
        ).status === "failed",
    );
    const timed = db
      .prepare("SELECT history FROM express_jobs WHERE id=?")
      .get(id) as { history: string };
    assert.ok(
      JSON.parse(timed.history).some((h: any) => h.stage === "running"),
      "timeout must interrupt a real running workload",
    );
    if (process.platform !== "win32")
      await until(() => {
        try {
          process.kill(-pid, 0);
          return false;
        } catch {
          return true;
        }
      });
    assert.deepEqual(await fs.readdir(temp), []);
    await jobs.stop();
    const abandoned = enqueueExample(db);
    jobs = await startJobs(db, dir, temp);
    assert.match(
      (
        db
          .prepare("SELECT error FROM express_jobs WHERE id=?")
          .get(abandoned) as any
      ).error,
      /Interrupted/,
    );
    const preserved = db
      .prepare("SELECT count(*) AS n FROM express_jobs")
      .get() as any;
    assert.equal(preserved.n, 2);
  } finally {
    await jobs.stop();
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
