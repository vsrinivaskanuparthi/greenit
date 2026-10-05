import { z } from "zod";
export const TOOL_VERSION = "0.1.0";
const text = z.string().max(2000);
export const relativePath = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !p.includes("\\") &&
      !/^[A-Za-z]:/.test(p) &&
      !p.split("/").some((s) => s === ".." || s === ".") &&
      !/[\x00-\x1f]/.test(p),
    "Must be a safe relative path",
  );
const amount = z.number().finite().nonnegative().max(1e15);
export const contextSchema = z
  .object({
    period: z.string().trim().min(1).max(200),
    boundary: z.string().trim().min(1).max(500),
    workload: z.string().trim().min(1).max(200),
    provenance: z.enum(["measured", "externally modelled", "synthetic"]),
    workCount: z.number().finite().min(1e-9).max(1e15).optional(),
    workUnit: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .refine(
    (v) => (v.workCount === undefined) === (v.workUnit === undefined),
    "Supply both work count and unit",
  );
const contextFields = {
  period: z.string().trim().min(1).max(200),
  boundary: z.string().trim().min(1).max(500),
  workload: z.string().trim().min(1).max(200),
  provenance: z.enum(["measured", "externally modelled", "synthetic"]),
  workCount: z.number().finite().min(1e-9).max(1e15).optional(),
  workUnit: z.string().trim().min(1).max(80).optional(),
};
export const operationalSchema = z
  .object({
    ...contextFields,
    kWh: amount,
    intensity: amount,
    factorSource: text.optional(),
    factorDate: z.string().max(50).optional(),
    factorRegion: z.string().max(100).optional(),
  })
  .strict()
  .refine(
    (v) => (v.workCount === undefined) === (v.workUnit === undefined),
    "Supply both work count and unit",
  );
export const transferSchema = z
  .object({
    ...contextFields,
    bytes: amount.int(),
    greenHosting: z.boolean(),
    model: z.literal("swd-v4"),
    packageVersion: z.string().min(1).max(30),
  })
  .strict()
  .refine(
    (v) => (v.workCount === undefined) === (v.workUnit === undefined),
    "Supply both work count and unit",
  );
export const carbonSchema = z
  .object({
    operational: operationalSchema.optional(),
    transfer: transferSchema.optional(),
  })
  .strict();
export type Carbon = z.infer<typeof carbonSchema>;
export const findingSchema = z
  .object({
    ruleId: z.string().regex(/^[a-z0-9-]{1,80}$/),
    ruleVersion: z.string().max(30),
    severity: z.enum(["high", "medium", "low"]),
    confidence: z.enum(["high", "medium"]),
    file: relativePath,
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    title: text,
    evidence: text,
    explanation: text,
    remediation: text,
    tradeoffs: text,
    verification: text,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type Finding = z.infer<typeof findingSchema>;
export const reportSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    tool: z
      .object({ name: z.literal("green-it"), version: z.string().max(30) })
      .strict(),
    createdAt: z.string().datetime(),
    provenance: z
      .object({ origin: z.enum(["cli", "zip"]), synthetic: z.boolean() })
      .strict(),
    detection: z.array(z.string().max(100)).max(50),
    coverage: z
      .object({
        status: z.enum(["partial", "none"]),
        analysed: z.array(relativePath).max(10000),
        excluded: z
          .array(z.object({ file: relativePath, reason: text }).strict())
          .max(20000),
        parserErrors: z
          .array(z.object({ file: relativePath, message: text }).strict())
          .max(10000),
        limitations: z.array(text).max(50),
      })
      .strict(),
    findings: z.array(findingSchema).max(20000),
    carbon: carbonSchema.optional(),
  })
  .strict()
  .superRefine((r, c) => {
    const seen = new Set<string>();
    r.findings.forEach((f, i) => {
      if (seen.has(f.fingerprint))
        c.addIssue({
          code: "custom",
          message: "Duplicate fingerprint",
          path: ["findings", i],
        });
      seen.add(f.fingerprint);
    });
  });
export type Report = z.infer<typeof reportSchema>;
export function operational(input: unknown) {
  const v = operationalSchema.parse(input);
  const grams = v.kWh * v.intensity;
  return {
    grams,
    perUnit: v.workCount === undefined ? undefined : grams / v.workCount,
  };
}
export function compare(a: Report, b: Report) {
  const left = new Map(a.findings.map((f) => [f.fingerprint, f]));
  const right = new Map(b.findings.map((f) => [f.fingerprint, f]));
  return {
    added: b.findings.filter((f) => !left.has(f.fingerprint)),
    resolved: a.findings.filter((f) => !right.has(f.fingerprint)),
    unchanged: b.findings.filter((f) => left.has(f.fingerprint)),
  };
}
export function carbonCompatibility(
  a: Carbon | undefined,
  b: Carbon | undefined,
  kind: "operational" | "transfer",
) {
  const x = a?.[kind],
    y = b?.[kind];
  if (!x || !y) return "Both scans need inputs for this calculator.";
  for (const key of [
    "period",
    "boundary",
    "workload",
    "workUnit",
    "workCount",
    "provenance",
  ] as const)
    if (x[key] !== y[key])
      return `Incompatible ${key}; estimates cannot be compared.`;
  if (!x.workUnit || !x.workCount)
    return "A common completed-work count and functional unit are required.";
  if (
    kind === "transfer" &&
    (a?.transfer?.model !== b?.transfer?.model ||
      a?.transfer?.packageVersion !== b?.transfer?.packageVersion ||
      a?.transfer?.greenHosting !== b?.transfer?.greenHosting)
  )
    return "Transfer model, version or hosting assumptions differ.";
  return null;
}
