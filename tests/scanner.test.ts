import { test } from "node:test";
import assert from "node:assert/strict";
import { scan, analyseCode } from "../packages/analysis-core/src/index.ts";
import { reportSchema } from "../packages/shared/src/index.ts";
import { mkdtemp, writeFile, rm, mkdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
test("synthetic positive and negative fixtures cover all five rules", async () => {
  const a = await scan("examples/before", { synthetic: true });
  const b = await scan("examples/after");
  assert.equal(a.findings.length, 5);
  assert.equal(new Set(a.findings.map((f) => f.ruleId)).size, 5);
  assert.equal(b.findings.length, 0);
  assert.equal(reportSchema.parse(a).coverage.status, "partial");
  assert.equal(a.carbon, undefined);
  assert.deepEqual(
    a.findings.map((f) => f.fingerprint),
    (await scan("examples/before")).findings.map((f) => f.fingerprint),
  );
});
test("shadowed globals and nested callback awaits are not reported", () => {
  assert.equal(
    analyseCode(
      "async function a(fetch){for(const x of xs){await fetch(x)}}",
      "x.js",
    ).length,
    0,
  );
  assert.equal(
    analyseCode("for(const x of xs){const f=async()=>await fetch(x)}", "x.js")
      .length,
    0,
  );
  assert.equal(
    analyseCode("function a(setInterval){setInterval(work, 10)}", "x.js")
      .length,
    0,
  );
});
test("ignore, secrets, symlinks, unsupported and parser failures are visible", async () => {
  const d = await mkdtemp(path.join(os.tmpdir(), "green-test-"));
  try {
    await writeFile(path.join(d, "pom.xml"), "<project/>");
    await writeFile(path.join(d, "X.java"), "class X {}");
    await writeFile(path.join(d, ".env"), "SECRET=synthetic");
    await writeFile(path.join(d, ".gitignore"), "skip.js\n");
    await writeFile(path.join(d, "skip.js"), "setInterval(work,1)");
    await symlink("/etc/passwd", path.join(d, "link.js"));
    await writeFile(path.join(d, "broken.ts"), "const = ;");
    await mkdir(path.join(d, "node_modules"));
    const r = await scan(d);
    assert.equal(r.coverage.status, "none");
    assert.ok(r.detection.includes("Java (unsupported)"));
    assert.equal(r.coverage.parserErrors.length, 1);
    assert.ok(r.coverage.excluded.some((x) => x.reason === "symlink"));
    assert.ok(r.coverage.excluded.some((x) => x.file === ".env"));
    assert.equal(r.findings.length, 0);
  } finally {
    await rm(d, { recursive: true, force: true });
  }
});
test("fingerprints survive whitespace and line shifts", () => {
  const code = "setInterval(work, 10);";
  assert.equal(
    analyseCode(code, "a.js")[0].fingerprint,
    analyseCode("\n\n// comment\n" + code, "a.js")[0].fingerprint,
  );
});
