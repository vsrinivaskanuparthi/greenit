import {
  evidenceSchema,
  modelInfo,
  type Evidence,
  type TrafficResult,
} from "../../../packages/shared/src/traffic.ts";
import { transfer } from "../../../packages/shared/src/carbon.ts";
// Discard the HAR object immediately after this allowlisted projection. Never persist URLs or payloads.
export function readHar(input: unknown): Evidence {
  const root = input as any;
  if (
    !root ||
    !["1.1", "1.2"].includes(root.log?.version) ||
    !Array.isArray(root.log.entries) ||
    root.log.entries.length > 5000
  )
    throw Error("Expected HAR 1.1/1.2 with at most 5,000 requests.");
  const entries = root.log.entries.map((raw: any, i: number) => {
    const e = raw && typeof raw === "object" ? raw : {},
      r = e.response ?? {};
    const status =
      Number.isInteger(r.status) && r.status >= 100 && r.status <= 599
        ? r.status
        : 0;
    const method = [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ].includes(e.request?.method)
      ? e.request.method
      : "OTHER";
    const n = r.bodySize;
    let reason: Evidence["entries"][number]["reason"] = "included";
    if (status === 0 || e._error || r._error) reason = "failed";
    else if (
      [e, r].some(
        (x) =>
          x._fromCache === true ||
          x._fromDiskCache === true ||
          x._fromMemoryCache === true ||
          x._fromServiceWorker === true,
      ) ||
      e._fromCache === "disk" ||
      e._fromCache === "memory"
    )
      reason = "cached";
    else if (n === undefined || n === null || n === -1) reason = "missing";
    else if (
      !Number.isSafeInteger(n) ||
      n < 0 ||
      n > 1e12 ||
      (([204, 205, 304].includes(status) || method === "HEAD") && n !== 0)
    )
      reason = "invalid";
    return {
      label: `Request ${i + 1}`,
      method,
      status,
      bytes: reason === "included" ? n : null,
      reason,
      field: reason === "included" ? "response.bodySize" : "none",
    };
  });
  return evidenceSchema.parse({ kind: "har", entries });
}
export function estimateTraffic(input: Evidence): TrafficResult {
  const evidence = evidenceSchema.parse(input),
    included = evidence.entries.filter(
      (e) => e.reason === "included" && e.bytes !== null,
    );
  const recordedBytes = included.reduce((n, e) => n + e.bytes!, 0);
  // One pinned adapter for both HAR and controlled sample. No public hosting checks.
  const estimate = (bytes: number) =>
    transfer({
      bytes,
      greenHosting: false,
      packageVersion: "0.18.0",
      model: "swd-v4",
      provenance: "measured",
      period: "recorded journey",
      boundary: "recorded response bodies; SWD v4 proxy boundary",
      workload: "recorded HTTP responses",
    }).grams;
  return {
    evidence,
    recordedBytes,
    includedRequests: included.length,
    excludedRequests: evidence.entries.length - included.length,
    failedResponses: evidence.entries.filter(
      (e) => e.reason === "failed" || e.status >= 400,
    ).length,
    grams: included.length ? estimate(recordedBytes) : null,
    model: modelInfo,
    contributions: included
      .map((e) => ({
        label: e.label,
        bytes: e.bytes!,
        grams: estimate(e.bytes!),
        status: e.status,
        method: e.method,
      }))
      .sort((a, b) => b.bytes - a.bytes),
  };
}
