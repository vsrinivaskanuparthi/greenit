import { parse } from "@babel/parser";
import traverseModule, { type NodePath } from "@babel/traverse";
import { createHash } from "node:crypto";
import type { Finding } from "../../shared/src/index.ts";
const traverse =
  (traverseModule as unknown as { default: typeof traverseModule }).default ??
  traverseModule;
type Rule = Omit<Finding, "file" | "line" | "column" | "fingerprint">;
const rule = (
  ruleId: string,
  title: string,
  evidence: string,
  explanation: string,
  remediation: string,
  tradeoffs: string,
  verification: string,
  confidence: "high" | "medium" = "high",
): Rule => ({
  ruleId,
  ruleVersion: "1.0.0",
  severity: "medium",
  confidence,
  title,
  evidence,
  explanation,
  remediation,
  tradeoffs,
  verification,
});
const loop = (p: NodePath) => p.findParent((x) => x.isLoop() || x.isFunction());
function isGlobal(p: NodePath, name: string) {
  return !p.scope.getBinding(name);
}
function imported(p: NodePath, name: string, module: string, member?: string) {
  const b = p.scope.getBinding(name);
  if (!b) return false;
  const q = b.path;
  return (
    q.parentPath?.isImportDeclaration() &&
    q.parentPath.node.source.value === module &&
    (!member ||
      (q.isImportSpecifier() &&
        q.node.imported.type === "Identifier" &&
        q.node.imported.name === member))
  );
}
function callName(n: any) {
  return n?.type === "Identifier"
    ? n.name
    : n?.type === "MemberExpression" &&
        !n.computed &&
        n.object.type === "Identifier" &&
        n.property.type === "Identifier"
      ? `${n.object.name}.${n.property.name}`
      : "";
}
function inlineExpressHandler(p: NodePath) {
  const fn = p.getFunctionParent();
  const parent = fn?.parentPath;
  if (
    !fn ||
    !parent?.isCallExpression() ||
    !parent.node.arguments.includes(fn.node as any)
  )
    return null;
  const callee = parent.node.callee;
  if (
    callee.type !== "MemberExpression" ||
    callee.computed ||
    callee.object.type !== "Identifier" ||
    callee.property.type !== "Identifier" ||
    !["get", "post", "put", "delete", "patch", "use"].includes(
      callee.property.name,
    )
  )
    return null;
  const binding = p.scope.getBinding(callee.object.name);
  if (!binding?.path.isVariableDeclarator()) return null;
  const init = binding.path.node.init;
  return init?.type === "CallExpression" &&
    init.callee.type === "Identifier" &&
    imported(p, init.callee.name, "express")
    ? fn
    : null;
}
function fixedJsonPath(
  p: NodePath,
  expression: any,
  handler: NodePath,
): boolean {
  let init = expression;
  if (init?.type === "Identifier") {
    const binding = p.scope.getBinding(init.name);
    if (
      !binding?.constant ||
      !binding.path.isVariableDeclarator() ||
      binding.path.findParent((x) => x === handler)
    )
      return false;
    init = binding.path.node.init;
  }
  if (init?.type === "StringLiteral") return init.value.endsWith(".json");
  return (
    init?.type === "NewExpression" &&
    init.callee.type === "Identifier" &&
    init.callee.name === "URL" &&
    isGlobal(p, "URL") &&
    init.arguments[0]?.type === "StringLiteral" &&
    /^\.\.?\/.+\.json$/.test(init.arguments[0].value) &&
    init.arguments[1]?.type === "MemberExpression" &&
    !init.arguments[1].computed &&
    init.arguments[1].object.type === "MetaProperty" &&
    init.arguments[1].object.meta.name === "import" &&
    init.arguments[1].object.property.name === "meta" &&
    init.arguments[1].property.name === "url"
  );
}
export function analyseCode(code: string, file: string): Finding[] {
  const ast = parse(code, {
    sourceType: "unambiguous",
    plugins: [
      ...(/\.[cm]?tsx?$/.test(file) ? ["typescript" as const] : []),
      "jsx",
    ],
  });
  const findings: Finding[] = [];
  const occurrences = new Map<string, number>();
  function add(p: NodePath, r: Rule) {
    const normalized = JSON.stringify(p.node, (k, v) =>
      [
        "start",
        "end",
        "loc",
        "extra",
        "leadingComments",
        "trailingComments",
        "innerComments",
      ].includes(k)
        ? undefined
        : v,
    );
    const base = `${r.ruleId}@${r.ruleVersion}|${file}|${normalized}`;
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    findings.push({
      ...r,
      file,
      line: p.node.loc?.start.line ?? 1,
      column: (p.node.loc?.start.column ?? 0) + 1,
      fingerprint: createHash("sha256")
        .update(`${base}|${occurrence}`)
        .digest("hex"),
    });
  }
  traverse(ast, {
    AwaitExpression(p) {
      const enclosing = loop(p);
      const a = p.node.argument;
      if (
        !enclosing?.isLoop() ||
        a.type !== "CallExpression" ||
        a.callee.type !== "Identifier" ||
        a.callee.name !== "fetch" ||
        !isGlobal(p, "fetch")
      )
        return;
      add(
        p,
        rule(
          "await-fetch-in-loop",
          "Sequential network wait inside a loop",
          "An awaited global fetch call appears directly within a loop.",
          "Each iteration waits for a network response before proceeding. This can extend the active duration of the task.",
          "Review bounded concurrency, batching, or caching where requests are independent.",
          "Ordering, rate limits, memory use and remote service capacity may require sequential execution.",
          "Measure completed-work latency and resource use with the same workload before and after changes.",
        ),
      );
    },
    CallExpression(p) {
      const n = p.node;
      const name = callName(n.callee);
      if (
        name === "setInterval" &&
        isGlobal(p, "setInterval") &&
        n.arguments[1]?.type === "NumericLiteral" &&
        n.arguments[1].value >= 0 &&
        n.arguments[1].value < 1000
      )
        add(
          p,
          rule(
            "short-interval",
            "Recurring timer below one second",
            "A global setInterval call has a literal delay below 1000 ms.",
            "Frequent callbacks can create avoidable background work; this may be intentional.",
            "Review a longer interval, event-driven updates, or pausing when inactive.",
            "Responsiveness and real-time requirements may justify this frequency.",
            "Measure callback frequency, idle CPU and responsiveness under an equivalent workload.",
          ),
        );
      if (name === "JSON.parse" && isGlobal(p, "JSON")) {
        const handler = inlineExpressHandler(p);
        const read = n.arguments[0];
        if (
          handler &&
          n.arguments.length === 1 &&
          read?.type === "CallExpression" &&
          read.callee.type === "MemberExpression" &&
          !read.callee.computed &&
          read.callee.object.type === "Identifier" &&
          read.callee.property.type === "Identifier" &&
          read.callee.property.name === "readFileSync" &&
          (imported(p, read.callee.object.name, "node:fs") ||
            imported(p, read.callee.object.name, "fs")) &&
          read.arguments[1]?.type === "StringLiteral" &&
          ["utf8", "utf-8"].includes(read.arguments[1].value) &&
          fixedJsonPath(p, read.arguments[0], handler)
        ) {
          add(
            p,
            rule(
              "request-reference-json",
              "Reference JSON read and parsed on every request",
              "An inline Express handler parses a synchronous UTF-8 read from a fixed JSON path.",
              "Every matching request repeats the file read and JSON parse. The OS may cache file bytes, but these application operations still occur.",
              "If the data changes infrequently, review loading and parsing once at startup and reusing it with an explicit refresh or restart policy.",
              "Caching retains memory, can serve stale data, and shares object identity. Do not use this change when each request requires fresh data; avoid mutating the cached object.",
              "Validate equivalent responses, then compare repeated runs with equal requests, concurrency and warm-up. Measure process CPU, memory and duration; use energy measurements or a clearly labelled energy model for carbon claims.",
            ),
          );
        }
        const l = loop(p);
        const arg = n.arguments[0];
        if (l?.isLoop() && arg?.type === "Identifier") {
          const b = p.scope.getBinding(arg.name);
          if (
            b?.constant &&
            b.path.isVariableDeclarator() &&
            b.path.node.init?.type === "StringLiteral" &&
            !b.path.findParent((x) => x === l)
          )
            add(
              p,
              rule(
                "constant-json-in-loop",
                "Unchanged JSON parsed repeatedly",
                "JSON.parse reads a constant string binding declared outside the loop.",
                "The same literal JSON input is parsed on each iteration.",
                "Consider parsing once outside the loop if sharing the result is safe.",
                "Each parse creates a fresh object; moving it changes object identity and mutation isolation.",
                "Profile parsing cost and test object mutation and identity behaviour.",
              ),
            );
        }
      }
      if (
        n.callee.type === "MemberExpression" &&
        !n.callee.computed &&
        n.callee.object.type === "Identifier" &&
        n.callee.property.type === "Identifier" &&
        [
          "readFileSync",
          "writeFileSync",
          "appendFileSync",
          "readdirSync",
          "statSync",
        ].includes(n.callee.property.name)
      ) {
        const obj = n.callee.object.name;
        if (!imported(p, obj, "node:fs") && !imported(p, obj, "fs")) return;
        const fn = p.getFunctionParent();
        const parent = fn?.parentPath;
        if (
          !parent?.isCallExpression() ||
          !fn ||
          !parent.node.arguments.includes(fn.node as any)
        )
          return;
        const callee = parent.node.callee;
        if (
          callee.type !== "MemberExpression" ||
          callee.computed ||
          callee.object.type !== "Identifier" ||
          callee.property.type !== "Identifier" ||
          !["get", "post", "put", "delete", "patch", "use"].includes(
            callee.property.name,
          )
        )
          return;
        const b = p.scope.getBinding(callee.object.name);
        if (!b?.path.isVariableDeclarator()) return;
        const init = b.path.node.init;
        if (
          init?.type !== "CallExpression" ||
          init.callee.type !== "Identifier" ||
          !imported(p, init.callee.name, "express")
        )
          return;
        add(
          p,
          rule(
            "sync-fs-handler",
            "Synchronous filesystem call in an Express handler",
            "A node:fs/fs synchronous method is called directly in an inline Express handler.",
            "Synchronous I/O blocks the Node.js event loop while the operation completes.",
            "Review promise-based filesystem I/O or an appropriate cache.",
            "Async conversion changes error handling; caching needs invalidation and memory limits.",
            "Load-test throughput and event-loop delay using the same requests.",
          ),
        );
      }
      const effect =
        (name === "useEffect" &&
          n.callee.type === "Identifier" &&
          imported(p, "useEffect", "react", "useEffect")) ||
        (name === "React.useEffect" && imported(p, "React", "react"));
      if (effect) {
        const cb = p.get("arguments.0") as NodePath;
        if (!cb?.isFunction()) return;
        const timers: Array<{ path: NodePath; id: string | undefined }> = [];
        const cleared = new Set<string>();
        cb.traverse({
          CallExpression(t) {
            if (
              t.getFunctionParent() === cb &&
              callName(t.node.callee) === "setInterval" &&
              isGlobal(t, "setInterval")
            ) {
              const v = t.parentPath;
              timers.push({
                path: t,
                id:
                  v.isVariableDeclarator() && v.node.id.type === "Identifier"
                    ? v.node.id.name
                    : undefined,
              });
            }
          },
          ReturnStatement(r) {
            if (r.getFunctionParent() !== cb) return;
            const a = r.get("argument");
            if (!a?.isFunction()) return;
            a.traverse({
              CallExpression(c) {
                if (
                  callName(c.node.callee) === "clearInterval" &&
                  isGlobal(c, "clearInterval") &&
                  c.node.arguments[0]?.type === "Identifier"
                )
                  cleared.add(c.node.arguments[0].name);
              },
            });
          },
        });
        for (const t of timers)
          if (!t.id || !cleared.has(t.id))
            add(
              t.path,
              rule(
                "effect-interval-cleanup",
                "Effect timer has no identifiable cleanup",
                "A React useEffect creates an interval without a matching clearInterval in a returned cleanup function.",
                "The timer may continue after unmounting or accumulate when the effect reruns.",
                "Return a cleanup function that clears the interval handle.",
                "Cleanup hidden in helpers or custom hooks is outside this narrow heuristic; inspect before changing.",
                "Mount, rerender and unmount the component; verify active timer count and callback cessation.",
                "medium",
              ),
            );
      }
    },
  });
  return findings;
}
