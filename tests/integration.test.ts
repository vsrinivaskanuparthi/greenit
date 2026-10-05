import { request as httpRequest } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  readdir,
  writeFile,
  mkdir,
  access,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { once } from "node:events";
import yazl from "yazl";
import { createApp, apiErrors } from "../apps/api/src/app.ts";
import { openStore } from "../apps/api/src/store.ts";
import { startJobs } from "../apps/api/src/jobs.ts";
import { extractZip, safeEntry, limits } from "../apps/api/src/archive.ts";
import { scan } from "../packages/analysis-core/src/index.ts";
import { reportSchema, compare } from "../packages/shared/src/index.ts";
async function zipBuffer(
  files: Array<{ name: string; data: string | Buffer; mode?: number }>,
) {
  const zip = new yazl.ZipFile();
  const chunks: Buffer[] = [];
  zip.outputStream.on("data", (b) => chunks.push(b));
  for (const f of files)
    zip.addBuffer(Buffer.from(f.data), f.name, { mode: f.mode });
  zip.end();
  await once(zip.outputStream, "end");
  return Buffer.concat(chunks);
}
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean) {
  for (let i = 0; i < 120; i++) {
    const v = await fn();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Timed out waiting for worker");
}
test("ZIP security: traversal, absolute, symlink, encrypted and expansion limits", async () => {
  for (const name of ["../x", "/tmp/x", "C:/x", "a\\b", "a/../b", "a//b"])
    assert.throws(() => safeEntry(name));
  const d = await mkdtemp(path.join(os.tmpdir(), "green-zip-"));
  try {
    const valid = await zipBuffer([
      { name: "abc.js", data: "setInterval(work,10)" },
    ]);
    const traversal = Buffer.from(valid);
    for (let i = 0; i < traversal.length - 6; i++)
      if (traversal.subarray(i, i + 6).toString() === "abc.js")
        traversal.write("../bad", i);
    const symlink = await zipBuffer([
      { name: "link", data: "../../outside", mode: 0o120777 },
    ]);
    const big = await zipBuffer([
      { name: "huge.js", data: Buffer.alloc(limits.file + 1) },
    ]);
    const encrypted = Buffer.from(valid);
    encrypted.writeUInt16LE(encrypted.readUInt16LE(6) | 1, 6);
    for (let i = 0; i < encrypted.length - 4; i++)
      if (encrypted.readUInt32LE(i) === 0x02014b50)
        encrypted.writeUInt16LE(encrypted.readUInt16LE(i + 8) | 1, i + 8);
    for (const [i, b] of [traversal, symlink, big, encrypted].entries()) {
      const p = path.join(d, `${i}.zip`);
      await writeFile(p, b);
      await assert.rejects(extractZip(p, path.join(d, `out-${i}`)));
    }
    // False uncompressed metadata must not bypass streamed byte enforcement.
    const lied = await zipBuffer([
      { name: "large.js", data: Buffer.alloc(limits.file + 10, 65) },
    ]);
    for (let i = 0; i < lied.length - 4; i++) {
      const sig = lied.readUInt32LE(i);
      if (sig === 0x04034b50) lied.writeUInt32LE(1, i + 22);
      if (sig === 0x02014b50) lied.writeUInt32LE(1, i + 24);
    }
    await writeFile(path.join(d, "lie.zip"), lied);
    await assert.rejects(
      extractZip(path.join(d, "lie.zip"), path.join(d, "lie")),
    );
  } finally {
    await rm(d, { recursive: true, force: true });
  }
});
test("API imports, ZIP worker equivalence, cleanup, persistence, interrupted recovery and deletion", async () => {
  const d = await mkdtemp(path.join(os.tmpdir(), "green-api-"));
  const tmp = path.join(d, "temporary");
  let db = openStore(d);
  let jobs = await startJobs(db, d, tmp);
  const app = createApp(db, tmp);
  app.use(apiErrors);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address() as { port: number };
  const base = `http://127.0.0.1:${addr.port}`;
  const request = (url: string, body: unknown) =>
    fetch(base + url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const report = await scan("examples/before", { synthetic: true });
    assert.equal(
      (
        await request("/api/import", {
          projectName: "Demo",
          report: { ...report, schemaVersion: "99" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/api/import", {
          projectName: "Demo",
          report: {
            ...report,
            findings: [{ ...report.findings[0], file: "/secret" }],
          },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + "/api/projects", {
          headers: { origin: "http://evil.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      await new Promise<number | undefined>((resolve, reject) => {
        const req = httpRequest(
          base + "/api/projects",
          { headers: { host: "evil.example" } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on("error", reject);
        req.end();
      }),
      403,
    );
    const imp = await request("/api/import", { projectName: "Demo", report });
    assert.equal(imp.status, 201);
    const imported = (await imp.json()) as { id: string };
    const got = (await (
      await fetch(base + "/api/scans/" + imported.id)
    ).json()) as any;
    assert.equal(got.origin, "import");
    assert.deepEqual(got.report, report);
    const form = new FormData();
    form.append("projectName", "Demo");
    form.append("synthetic", "true");
    const files = await Promise.all(
      (await readdir("examples/before")).map(async (name) => ({
        name,
        data: await readFile(path.join("examples/before", name)),
      })),
    );
    files.push({
      name: "package.json",
      data: Buffer.from(
        JSON.stringify({
          scripts: { postinstall: `touch ${path.join(d, "MUST_NOT_EXECUTE")}` },
          dependencies: { react: "*" },
        }),
      ),
    });
    files.push({
      name: "execution-tripwire.js",
      data: Buffer.from(
        `require('node:fs').writeFileSync(${JSON.stringify(path.join(d, "MUST_NOT_EXECUTE"))},'executed')`,
      ),
    });
    form.append(
      "archive",
      new Blob([new Uint8Array(await zipBuffer(files))]),
      "demo.zip",
    );
    const up = await fetch(base + "/api/upload", {
      method: "POST",
      body: form,
    });
    assert.equal(up.status, 202);
    const id = ((await up.json()) as any).id;
    const completed = await until(
      async () =>
        (await (await fetch(base + "/api/scans/" + id)).json()) as any,
      (s) => ["completed", "failed"].includes(s.status),
    );
    assert.equal(completed.status, "completed");
    assert.deepEqual(completed.report.findings, report.findings);
    assert.equal(completed.report.provenance.synthetic, true);
    assert.equal(completed.report.carbon, undefined);
    await until(
      () => readdir(tmp),
      (v) => v.length === 0,
    );
    await assert.rejects(access(path.join(d, "MUST_NOT_EXECUTE")));
    const exported = await (
      await fetch(base + "/api/scans/" + id + "/export")
    ).json();
    assert.deepEqual(reportSchema.parse(exported), completed.report);
    assert.equal(
      compare(report, await scan("examples/after")).resolved.length,
      5,
    );
    const inputs = {
      operational: {
        kWh: 0.25,
        intensity: 400,
        period: "one hour",
        boundary: "synthetic wall plug",
        workload: "fixed test",
        provenance: "synthetic",
        workCount: 1000,
        workUnit: "requests",
      },
    };
    const carbonResponse = await fetch(base + "/api/scans/" + id + "/carbon", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(inputs),
    });
    assert.equal(carbonResponse.status, 200);
    completed.report = await carbonResponse.json();
    assert.deepEqual(completed.report.carbon, inputs);
    assert.equal(
      (
        await fetch(base + "/api/scans/" + id + "/carbon", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operational: { ...inputs.operational, kWh: -1 },
          }),
        })
      ).status,
      400,
    );
    const badForm = new FormData();
    badForm.append("projectName", "Demo");
    badForm.append(
      "archive",
      new Blob([
        new Uint8Array(
          await zipBuffer([
            { name: "link", data: "/etc/passwd", mode: 0o120777 },
          ]),
        ),
      ]),
      "bad.zip",
    );
    const badId = (
      (await (
        await fetch(base + "/api/upload", { method: "POST", body: badForm })
      ).json()) as any
    ).id;
    assert.equal(
      (
        await until(
          async () =>
            (await (await fetch(base + "/api/scans/" + badId)).json()) as any,
          (s) => s.status === "failed",
        )
      ).status,
      "failed",
    );
    await until(
      () => readdir(tmp),
      (v) => v.length === 0,
    );
    await jobs.stop();
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
    db = openStore(d);
    const stored = db
      .prepare("SELECT report FROM scans WHERE id=?")
      .get(id) as any;
    assert.deepEqual(JSON.parse(stored.report), completed.report);
    const project = db.prepare("SELECT id FROM projects LIMIT 1").get() as any;
    db.prepare(
      "INSERT INTO scans(id,projectId,status,origin,createdAt) VALUES ('abandoned',?,'analysing','zip',?)",
    ).run(project.id, new Date().toISOString());
    await mkdir(path.join(tmp, "abandoned"), { recursive: true });
    await writeFile(path.join(tmp, "abandoned", "raw"), "synthetic");
    jobs = await startJobs(db, d, tmp);
    assert.equal(
      (db.prepare("SELECT status FROM scans WHERE id='abandoned'").get() as any)
        .status,
      "failed",
    );
    assert.deepEqual(await readdir(tmp), []);
    const app2 = createApp(db, tmp);
    app2.use(apiErrors);
    const s2 = app2.listen(0, "127.0.0.1");
    await once(s2, "listening");
    try {
      const b2 = `http://127.0.0.1:${(s2.address() as any).port}`;
      assert.equal(
        (await fetch(b2 + "/api/projects/" + project.id, { method: "DELETE" }))
          .status,
        204,
      );
      assert.equal(
        (db.prepare("SELECT COUNT(*) AS n FROM scans").get() as any).n,
        0,
      );
    } finally {
      await new Promise<void>((r) => s2.close(() => r()));
    }
  } finally {
    await jobs.stop();
    server.close();
    db.close();
    await rm(d, { recursive: true, force: true });
  }
});
