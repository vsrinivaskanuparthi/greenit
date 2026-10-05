import { api } from "./api.ts";
import { useState } from "react";
import {
  carbonSchema,
  operational,
  carbonCompatibility,
  type Carbon,
  type Report,
} from "../../../packages/shared/src/index.ts";
import { transfer, CO2_VERSION } from "../../../packages/shared/src/carbon.ts";
const fmt = (n: number) =>
  n === 0 ? "0" : n.toLocaleString(undefined, { maximumSignificantDigits: 6 });
function result(input: Carbon, kind: "operational" | "transfer") {
  const value = input[kind];
  if (!value) return null;
  try {
    return kind === "operational" ? operational(value) : transfer(value);
  } catch {
    return null;
  }
}
export function CarbonSection({
  scanId,
  carbon,
  refresh,
}: {
  scanId: string;
  carbon: Carbon | undefined;
  refresh: () => void;
}) {
  return (
    <section className="card">
      <div className="section-title">
        <div>
          <h2>Carbon estimates</h2>
        </div>
      </div>
      {!carbon?.operational && !carbon?.transfer && (
        <p className="notice">
          Carbon estimate unavailable — measurement inputs required.
        </p>
      )}
      <p>
        These calculators use your explicit inputs, never source size or
        findings. Do not add the two results: their boundaries may overlap. CPU
        utilisation and execution time are not measured energy.
      </p>
      <div className="calculator-grid">
        <Calculator
          key={"op" + JSON.stringify(carbon?.operational)}
          kind="operational"
          scanId={scanId}
          carbon={carbon}
          refresh={refresh}
        />
        <Calculator
          key={"tr" + JSON.stringify(carbon?.transfer)}
          kind="transfer"
          scanId={scanId}
          carbon={carbon}
          refresh={refresh}
        />
      </div>
    </section>
  );
}
function Calculator({
  kind,
  scanId,
  carbon,
  refresh,
}: {
  kind: "operational" | "transfer";
  scanId: string;
  carbon: Carbon | undefined;
  refresh: () => void;
}) {
  const value = carbon?.[kind];
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const estimate = carbon ? result(carbon, kind) : null;
  async function save(next: Carbon) {
    setBusy(true);
    setError("");
    try {
      const parsed = carbonSchema.parse(next);
      await api(
        `/scans/${scanId}/carbon`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed),
        },
        "save carbon inputs",
      );
      refresh();
    } catch (e) {
      setError(
        (e as Error).message.startsWith("[")
          ? "Check required inputs, non-negative finite values and paired work count/unit."
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="calculator">
      <h3>
        {kind === "operational"
          ? "Operational carbon estimate"
          : "CO2.js transfer estimate"}
      </h3>
      <p className="subtle">
        {kind === "operational"
          ? "Energy (kWh) × electricity intensity (gCO₂e/kWh). Excludes embodied hardware emissions; not a complete SCI assessment."
          : "Sustainable Web Design v4 · CO2.js " +
            CO2_VERSION +
            ". Models datacentre, network and user-device use plus embodied emissions using default global factors. Transferred bytes are a proxy, not measured energy."}
      </p>
      {estimate && value && (
        <div className="result" role="status">
          <span className="provenance">
            {value.provenance === "synthetic"
              ? "Sample data · synthetic inputs"
              : value.provenance + " inputs"}
          </span>
          <strong>{fmt(estimate.grams)} gCO₂e</strong>
          {estimate.perUnit !== undefined && (
            <p>
              {fmt(estimate.perUnit)} gCO₂e / {value.workUnit}
            </p>
          )}
          <p>
            {value.period} · {value.boundary}
          </p>
          <p>
            Workload: {value.workload}
            {value.workCount !== undefined
              ? ` · ${value.workCount} ${value.workUnit}`
              : ""}
          </p>
          {kind === "operational" && carbon?.operational && (
            <p>
              {carbon.operational.kWh} kWh × {carbon.operational.intensity}{" "}
              gCO₂e/kWh
            </p>
          )}
          {kind === "transfer" && carbon?.transfer && (
            <p>
              {carbon.transfer.bytes} bytes · green hosting assumption:{" "}
              {String(carbon.transfer.greenHosting)} · {carbon.transfer.model} /{" "}
              {carbon.transfer.packageVersion}
            </p>
          )}
          {value.provenance === "synthetic" && (
            <p>
              Illustrative only. No measured reduction or causal link to code
              edits.
            </p>
          )}
        </div>
      )}
      {value && !estimate && (
        <p className="error">
          Saved model version is unavailable locally. Inputs are preserved; no
          recomputed result is shown.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const val = (n: string) => String(data.get(n) ?? "").trim();
          const number = (n: string) =>
            val(n) === "" ? undefined : Number(val(n));
          const common = {
            period: val("period"),
            boundary: val("boundary"),
            workload: val("workload"),
            provenance: val("provenance"),
            ...(val("workCount") ? { workCount: number("workCount") } : {}),
            ...(val("workUnit") ? { workUnit: val("workUnit") } : {}),
          };
          const input =
            kind === "operational"
              ? {
                  ...common,
                  kWh: number("kWh"),
                  intensity: number("intensity"),
                  factorSource: val("factorSource"),
                  factorDate: val("factorDate"),
                  factorRegion: val("factorRegion"),
                }
              : {
                  ...common,
                  bytes: number("bytes"),
                  greenHosting: data.get("greenHosting") === "on",
                  model: "swd-v4",
                  packageVersion: CO2_VERSION,
                };
          void save({ ...carbon, [kind]: input } as Carbon);
        }}
      >
        <div className="form-grid">
          {kind === "operational" ? (
            <>
              <label>
                Energy consumption (kWh)
                <input
                  name="kWh"
                  type="number"
                  min="0"
                  max="1000000000000000"
                  step="any"
                  required
                  defaultValue={carbon?.operational?.kWh}
                />
              </label>
              <label>
                Electricity intensity (gCO₂e/kWh)
                <input
                  name="intensity"
                  type="number"
                  min="0"
                  max="1000000000000000"
                  step="any"
                  required
                  defaultValue={carbon?.operational?.intensity}
                />
              </label>
            </>
          ) : (
            <label>
              Transferred application bytes
              <input
                name="bytes"
                type="number"
                min="0"
                max="1000000000000000"
                step="1"
                required
                defaultValue={carbon?.transfer?.bytes}
              />
            </label>
          )}
          <label>
            Input provenance
            <select
              name="provenance"
              required
              defaultValue={value?.provenance ?? ""}
            >
              <option value="" disabled>
                Select provenance
              </option>
              <option value="measured">Measured</option>
              <option value="externally modelled">Externally modelled</option>
              <option value="synthetic">Synthetic demonstration</option>
            </select>
          </label>
          <label>
            Period / comparison basis
            <input
              name="period"
              required
              maxLength={200}
              placeholder="e.g. one 60-minute test"
              defaultValue={value?.period}
            />
          </label>
        </div>
        <label>
          System boundary
          <input
            name="boundary"
            required
            maxLength={500}
            placeholder={
              kind === "operational"
                ? "e.g. server wall-plug electricity only"
                : "e.g. web delivery, SWD v4 model boundary"
            }
            defaultValue={value?.boundary}
          />
        </label>
        <label>
          Workload description
          <input
            name="workload"
            required
            maxLength={200}
            placeholder="e.g. synthetic fixed request batch"
            defaultValue={value?.workload}
          />
        </label>
        <div className="form-grid">
          <label>
            Completed work count (optional)
            <input
              name="workCount"
              type="number"
              min="0.000000001"
              max="1000000000000000"
              step="any"
              defaultValue={value?.workCount}
            />
          </label>
          <label>
            Work unit (paired with count)
            <input
              name="workUnit"
              maxLength={80}
              placeholder="requests, jobs…"
              defaultValue={value?.workUnit}
            />
          </label>
        </div>
        {kind === "operational" ? (
          <details>
            <summary>Optional carbon-factor provenance</summary>
            <label>
              Factor source
              <input
                name="factorSource"
                maxLength={2000}
                defaultValue={carbon?.operational?.factorSource}
              />
            </label>
            <label>
              Factor date
              <input
                name="factorDate"
                type="date"
                defaultValue={carbon?.operational?.factorDate}
              />
            </label>
            <label>
              Factor region
              <input
                name="factorRegion"
                maxLength={100}
                defaultValue={carbon?.operational?.factorRegion}
              />
            </label>
          </details>
        ) : (
          <>
            <label className="check">
              <input
                type="checkbox"
                name="greenHosting"
                defaultChecked={carbon?.transfer?.greenHosting ?? false}
              />{" "}
              Assume green hosting (user supplied)
            </label>
            <p className="subtle">
              Defaults to false. No hosting check or external API is called.
              Never enter source ZIP size as application traffic.
            </p>
          </>
        )}
        <div className="actions" style={{ marginTop: 18 }}>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Calculate & save"}
          </button>
          {value && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                const next = { ...carbon };
                delete next[kind];
                void save(next);
              }}
            >
              Clear inputs
            </button>
          )}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
      <div className="print-only">
        Saved inputs:{" "}
        <pre>{JSON.stringify(value ?? "No inputs supplied", null, 2)}</pre>
      </div>
    </article>
  );
}
export function CarbonComparison({ a, b }: { a: Report; b: Report }) {
  return (
    <section className="card">
      <h2>Carbon comparison eligibility</h2>
      <p>
        Only matching declared workload, completed-work count and unit, period
        basis, boundary, provenance and model assumptions are compared. Matching
        text does not independently verify measurement comparability.
      </p>
      {(["operational", "transfer"] as const).map((kind) => {
        const reason = carbonCompatibility(a.carbon, b.carbon, kind);
        const x = a.carbon ? result(a.carbon, kind) : null,
          y = b.carbon ? result(b.carbon, kind) : null;
        return (
          <div key={kind}>
            <h3>
              {kind === "operational"
                ? "Operational estimate"
                : "CO2.js transfer estimate"}
            </h3>
            {reason ? (
              <p>{reason}</p>
            ) : x && y ? (
              <p className="notice">
                Baseline {fmt(x.grams)} → revised {fmt(y.grams)} gCO₂e.
                Difference: {fmt(y.grams - x.grams)} gCO₂e.{" "}
                {a.carbon?.[kind]?.provenance === "synthetic"
                  ? "Synthetic illustration only; no measured or causal reduction."
                  : "Modelled difference; no causal savings claim."}
              </p>
            ) : (
              <p>
                Model version unavailable locally; comparison cannot be
                reproduced.
              </p>
            )}
          </div>
        );
      })}
      <p className="subtle">
        Do not sum these estimates. Operational model: energy × intensity,
        excluding embodied hardware. CO2.js: SWD v4, including modelled use and
        embodied emissions.
      </p>
    </section>
  );
}
