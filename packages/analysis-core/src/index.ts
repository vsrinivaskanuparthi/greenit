import { promises as fs, constants } from "node:fs";
import path from "node:path";
import ignore from "ignore";
import { analyseCode } from "./rules.ts";
import {
  reportSchema,
  TOOL_VERSION,
  type Report,
} from "../../shared/src/index.ts";
export { analyseCode } from "./rules.ts";
export const MAX_FILE = 1024 * 1024;
async function readSource(file: string) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE)
      throw new Error("Unsafe or oversized source");
    const buffer = Buffer.alloc(MAX_FILE + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_FILE) throw new Error("Source grew beyond limit");
    return buffer.subarray(0, length).toString("utf8");
  } finally {
    await handle.close();
  }
}
export async function scan(
  root: string,
  options: {
    exclude?: string[];
    origin?: "cli" | "zip";
    synthetic?: boolean;
    maxMs?: number;
  } = {},
): Promise<Report> {
  root = path.resolve(root);
  if ((await fs.lstat(root)).isSymbolicLink())
    throw new Error("Scan root must not be a symlink");
  const start = Date.now();
  let entries = 0;
  let bytes = 0;
  const report: Report = {
    schemaVersion: "1.0",
    tool: { name: "green-it", version: TOOL_VERSION },
    createdAt: new Date().toISOString(),
    provenance: {
      origin: options.origin ?? "cli",
      synthetic: options.synthetic ?? false,
    },
    detection: [],
    coverage: {
      status: "none",
      analysed: [],
      excluded: [],
      parserErrors: [],
      limitations: [
        "Partial heuristic analysis only; no runtime measurements or sustainability certification.",
        "Only JavaScript, TypeScript, JSX and TSX are parsed. Dynamic calls, helper indirection, custom hooks and other frameworks may be missed.",
        "Ignore rules apply per directory; built-in secret and generated-file exclusions cannot be overridden.",
      ],
    },
    findings: [],
  };
  const detect = new Set<string>();
  const exclude = (file: string, reason: string) =>
    report.coverage.excluded.push({ file, reason });
  const secret =
    /(^\.env($|\.)|secret|credential|\.pem$|\.key$|^id_rsa|^\.npmrc$|^\.netrc$)/i;
  async function walk(
    dir: string,
    parents: Array<{ base: string; matcher: ReturnType<typeof ignore> }>,
  ) {
    const rel = path.relative(root, dir).split(path.sep).join("/");
    const matchers = [...parents];
    for (const name of [".gitignore", ".greenitignore"]) {
      try {
        const f = path.join(dir, name);
        const s = await fs.lstat(f);
        if (!s.isSymbolicLink() && s.size <= MAX_FILE)
          matchers.push({
            base: rel,
            matcher: ignore().add(await readSource(f)),
          });
      } catch {}
    }
    const list = await fs.readdir(dir, { withFileTypes: true });
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of list) {
      if (
        ++entries > 10000 ||
        Date.now() - start > (options.maxMs ?? 30000) ||
        bytes > 50 * 1024 * 1024
      )
        throw new Error(
          "Scan resource limit exceeded (10,000 entries / 50 MiB / time limit)",
        );
      const file = rel ? `${rel}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (/[\x00-\x1f\\]/.test(file)) {
        if (
          !report.coverage.limitations.includes(
            "Some unsafe filenames were omitted.",
          )
        )
          report.coverage.limitations.push(
            "Some unsafe filenames were omitted.",
          );
        continue;
      }
      if (ent.isSymbolicLink()) {
        exclude(file, "symlink");
        continue;
      }
      if (
        ["node_modules", ".git", "dist", "build", "coverage", ".next"].includes(
          ent.name,
        ) ||
        secret.test(ent.name)
      ) {
        exclude(file, "generated, dependency or likely secret");
        continue;
      }
      if (
        matchers.some((m) =>
          m.matcher.ignores(
            (m.base ? file.slice(m.base.length + 1) : file) +
              (ent.isDirectory() ? "/" : ""),
          ),
        ) ||
        ignore()
          .add(options.exclude ?? [])
          .ignores(file + (ent.isDirectory() ? "/" : ""))
      ) {
        exclude(file, "ignore rule");
        continue;
      }
      if (ent.isDirectory()) {
        await walk(full, matchers);
        continue;
      }
      if (!ent.isFile()) {
        exclude(file, "non-regular file");
        continue;
      }
      const stat = await fs.lstat(full);
      if (stat.size > MAX_FILE) {
        exclude(file, "file exceeds 1 MiB");
        continue;
      }
      bytes += stat.size;
      if (
        ent.name === "angular.json" ||
        ent.name === "pom.xml" ||
        file.endsWith(".java")
      )
        detect.add(
          file.endsWith(".java") || ent.name === "pom.xml"
            ? "Java (unsupported)"
            : "Angular (unsupported)",
        );
      if (ent.name === "package.json") {
        try {
          const pkg = JSON.parse(await readSource(full));
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps.react) detect.add("React");
          if (deps["@angular/core"]) detect.add("Angular (unsupported)");
          if (
            deps.express ||
            deps.fastify ||
            deps["@types/node"] ||
            pkg.engines?.node
          )
            detect.add("Node.js");
        } catch {
          exclude(file, "invalid package metadata");
        }
        continue;
      }
      if (!/\.[cm]?[jt]sx?$/.test(file)) {
        exclude(file, "unsupported or non-source file");
        continue;
      }
      try {
        const code = await readSource(full);
        if (code.includes("\0")) {
          exclude(file, "binary content");
          continue;
        }
        report.findings.push(...analyseCode(code, file));
        report.coverage.analysed.push(file);
        detect.add(/\.[cm]?tsx?$/.test(file) ? "TypeScript" : "JavaScript");
        if (/(?:from\s*|require\s*\()\s*['"]react['"]/.test(code))
          detect.add("React");
        if (/(?:from\s*|require\s*\()\s*['"]node:/.test(code))
          detect.add("Node.js");
      } catch {
        report.coverage.parserErrors.push({
          file,
          message:
            "Unable to parse with the configured JS/TS/JSX parser; source text omitted.",
        });
      }
    }
  }
  await walk(root, []);
  report.detection = [...detect].sort();
  report.coverage.status = report.coverage.analysed.length ? "partial" : "none";
  return reportSchema.parse(report);
}
