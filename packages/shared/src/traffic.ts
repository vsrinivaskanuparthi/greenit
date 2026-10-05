import { z } from "zod";
const bytes = z.number().int().nonnegative().max(1e12);
export const evidenceSchema = z
  .object({
    kind: z.enum(["har", "sample"]),
    entries: z
      .array(
        z
          .object({
            label: z.string().max(100),
            method: z.enum([
              "GET",
              "POST",
              "PUT",
              "PATCH",
              "DELETE",
              "HEAD",
              "OPTIONS",
              "OTHER",
            ]),
            status: z.number().int().min(0).max(599),
            bytes: bytes.nullable(),
            reason: z.enum([
              "included",
              "missing",
              "invalid",
              "cached",
              "failed",
            ]),
            field: z.enum(["response.bodySize", "collected HTTP body", "none"]),
          })
          .strict(),
      )
      .max(5000),
  })
  .strict();
export type Evidence = z.infer<typeof evidenceSchema>;
export const modelInfo = {
  package: "@tgwf/co2",
  packageVersion: "0.18.0",
  model: "swd",
  modelVersion: 4,
  greenHosting: false,
  bundledGridIntensityGramsPerKWh: 494,
  bundledKWhPerGB: {
    operational: { dataCentre: 0.055, network: 0.059, device: 0.08 },
    embodied: { dataCentre: 0.012, network: 0.013, device: 0.081 },
  },
  dataSource:
    "SWD v4 constants bundled in @tgwf/co2 0.18.0; global factor described by model documentation (Ember). Not a current local grid factor.",
  defaults:
    "Bundled SWD v4 global defaults; no hosting lookup or regional override",
  source: "https://developers.thegreenwebfoundation.org/co2js/models/overview/",
  checked: "2026-10-02",
  boundary:
    "Data-centre, network and user-device use plus embodied infrastructure, modelled using bytes as a proxy. Not a measured network electricity value or complete application footprint.",
} as const;
export type TrafficResult = {
  evidence: Evidence;
  recordedBytes: number;
  includedRequests: number;
  excludedRequests: number;
  failedResponses: number;
  grams: number | null;
  model: typeof modelInfo;
  contributions: {
    label: string;
    bytes: number;
    grams: number;
    status: number;
    method: string;
  }[];
};
