import { SampleLauncher } from "./sample-launcher.tsx";
import { ResourceIllustration } from "./resource-illustration.tsx";
import { useEffect, useState } from "react";
import { api } from "./api.ts";
import {
  benchmarkSchema,
  summariseBenchmark,
  scenarioEstimate,
  stats,
  type Benchmark,
  type BenchmarkRun,
} from "../../../packages/shared/src/benchmark.ts";
export const CARBON_EXPLANATION =
  "Running software consumes electricity through computing, storage and networking. Associated greenhouse-gas emissions are expressed as CO₂e. Unnecessary work can increase resource consumption and associated emissions. For Airbus applications, reducing avoidable resource use could support efficiency, cost control and sustainability objectives. Actual effects depend on workload, infrastructure and electricity supply. Carbon per completed task enables fairer comparisons than total emissions alone.";
const fmt = (n: number | null | undefined) =>
  n == null
    ? "—"
    : n.toLocaleString(undefined, { maximumSignificantDigits: 5 });
const mib = (bytes: number) => fmt(bytes / 1024 / 1024);
export function ExpressExample({
  jobId,
  onStarted,
}: {
  jobId?: string;
  onStarted: (id: string) => void;
}) {
  const [job, setJob] = useState<any>(null),
    [jobs, setJobs] = useState<any[]>([]);
  const stages = [
    ["reading", "Reading source"],
    ["checking", "Checking code"],
    ["running", "Running sample workload"],
    ["estimating", "Estimating carbon"],
    ["completed", "Results ready"],
  ];
  const [data, setData] = useState<Benchmark | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  async function load(signal?: AbortSignal) {
    setLoading(true);
    try {
      const response = await api(
        "/examples/express" +
          (jobId ? "?job=" + encodeURIComponent(jobId) : ""),
        { signal },
        "load the Express example",
      );
      if (signal?.aborted) return;
      setJob(response.job);
      setJobs(response.jobs ?? []);
      setData(
        response.benchmark ? benchmarkSchema.parse(response.benchmark) : null,
      );
      setError("");
    } catch (e) {
      if (!signal?.aborted) setError((e as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => void load(controller.signal), 1000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [jobId]);
  const summary = data ? summariseBenchmark(data) : null;
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Results and comparison</h1>
          <p>
            Reference-data caching: from unnecessary work to carbon per
            completed task.
          </p>
        </div>
        <div className="actions">
          <button
            className="secondary"
            disabled={loading}
            onClick={() => void load()}
          >
            Refresh results
          </button>
          {data && (
            <a
              className="secondary"
              href={
                "/api/examples/express/export" +
                (job?.id ? "?job=" + job.id : "")
              }
            >
              Download benchmark JSON
            </a>
          )}
        </div>
      </div>
      {jobs.length > 0 && (
        <label className="run-selector">
          Saved example analysis
          <select
            value={job?.id ?? ""}
            onChange={(e) => onStarted(e.target.value)}
          >
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {new Date(j.createdAt).toLocaleString()} · {j.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {job && (
        <section className="card" aria-label="Analysis progress">
          <div role="status" aria-live="polite">
            <strong>
              {job.status === "queued"
                ? "Waiting for the analysis worker"
                : job.status === "failed"
                  ? "Analysis failed"
                  : stages.find(([id]) => id === job.status)?.[1]}
            </strong>
          </div>
          <ol className="job-stages">
            {stages.map(([id, label]) => (
              <li
                key={id}
                className={
                  job.history?.some((h: any) => h.stage === id) ? "reached" : ""
                }
                aria-current={job.status === id ? "step" : undefined}
              >
                {label}
              </li>
            ))}
          </ol>
          {!["completed", "failed"].includes(job.status) && (
            <progress aria-label="Analysis in progress" />
          )}
          {job.status === "failed" && (
            <>
              <p role="alert">{job.error}</p>
              <SampleLauncher compact onStarted={onStarted} />
            </>
          )}
        </section>
      )}
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button className="secondary" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      <section className="card">
        <div className="section-title">
          <h2>Understanding software carbon</h2>
          <span className="tag sample">Sample application</span>
        </div>
        <p>
          Software uses electricity, and its associated emissions are expressed
          as CO₂e. Comparing carbon per completed task helps keep the amount of
          useful work consistent.
        </p>
        <details>
          <summary>Why this matters</summary>
          <p>{CARBON_EXPLANATION}</p>
        </details>
      </section>
      {loading && !data ? (
        <p role="status">Loading benchmark results…</p>
      ) : !data ? (
        <>{!job && <SampleLauncher onStarted={onStarted} />}</>
      ) : (
        summary && (
          <>
            <section className="card carbon-primary">
              <div className="section-title">
                <div>
                  <h2>Scenario CO₂e per 1,000 successful requests</h2>
                  <p>
                    Express sample · standard test workload · operational
                    compute
                  </p>
                  <p>
                    Scenario-based operational carbon estimate ·{" "}
                    {data.scenario.model} v{data.scenario.version}
                  </p>
                </div>
                <span className="tag">Measured resources · assumed energy</span>
              </div>
              <div className="benchmark-estimates">
                {(["before", "after"] as const).map((variant) => (
                  <div className="benchmark-estimate" key={variant}>
                    <h3>
                      {variant === "before"
                        ? "Before optimisation"
                        : "After optimisation"}
                    </h3>
                    <strong data-testid={"carbon-" + variant}>
                      {fmt(summary[variant].carbon?.mean)}{" "}
                      <span>gCO₂e / 1,000 requests</span>
                    </strong>
                    <p>
                      Mean across {summary[variant].carbon?.count ?? 0} measured
                      batches
                    </p>
                    <p className="subtle">
                      Range {fmt(summary[variant].carbon?.min)}–
                      {fmt(summary[variant].carbon?.max)} · SD{" "}
                      {fmt(summary[variant].carbon?.standardDeviation)} gCO₂e
                    </p>
                  </div>
                ))}
              </div>
              {summary.blocker ? (
                <p className="notice" role="status">
                  {summary.blocker} Individual batch scenarios may include
                  failed-request work; they are not an improvement claim.
                </p>
              ) : (
                <div className="benchmark-difference" role="status">
                  <strong>{summary.direction}</strong>
                  <span>
                    After − before: {fmt(summary.difference)} gCO₂e / 1,000
                    requests
                    {summary.percentage !== null
                      ? ` (${fmt(summary.percentage)}%)`
                      : " · percentage unavailable because the baseline is zero"}
                  </span>
                </div>
              )}
              {!summary.blocker &&
                summary.before.carbon &&
                summary.after.carbon &&
                Math.max(summary.before.carbon.min, summary.after.carbon.min) <=
                  Math.min(
                    summary.before.carbon.max,
                    summary.after.carbon.max,
                  ) && (
                  <p className="notice">
                    Run ranges overlap. The mean difference is descriptive and
                    inconclusive relative to observed variability; it does not
                    establish a repeatable improvement.
                  </p>
                )}
              <p className="subtle">
                The scenario assumes the same{" "}
                {data.scenario.allocatedPowerWatts} W allocation and{" "}
                {data.scenario.carbonIntensityGramsPerKWh} gCO₂e/kWh for both
                versions. Neither is measured application power or a local grid
                factor. The difference follows measured batch duration under
                these assumptions, not proof of actual emissions savings.
              </p>
            </section>
            <ResourceIllustration
              location={
                data.sources.before.scan.findings.find(
                  (f) => f.ruleId === "request-reference-json",
                )
                  ? "before/app.js:" +
                    data.sources.before.scan.findings.find(
                      (f) => f.ruleId === "request-reference-json",
                    )!.line
                  : undefined
              }
            />
            <section className="card">
              <div className="section-title">
                <h2>Measured resources and run variability</h2>
                <span className="subtle">
                  Collected {new Date(data.createdAt).toLocaleString()}
                </span>
              </div>
              <p>
                {data.config.pairs} repetitions per version ·{" "}
                {data.config.requests.toLocaleString()} requests per batch ·
                concurrency {data.config.concurrency} ·{" "}
                {data.config.warmupRequests} warm-up requests per fresh process.
                Before/after order alternates.
              </p>
              <div
                className="table-wrap"
                role="region"
                tabIndex={0}
                aria-label="Measured resource summary"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Before</th>
                      <th>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th>Successful / failed requests</th>
                      {(["before", "after"] as const).map((v) => (
                        <td key={v}>
                          {summary[v].successful.toLocaleString()} /{" "}
                          {summary[v].failed.toLocaleString()}
                          <small>
                            {summary[v].warmupFailures} warm-up failures
                          </small>
                        </td>
                      ))}
                    </tr>
                    {[
                      [
                        "Target elapsed (ms)",
                        (r: BenchmarkRun) => r.target?.elapsedMs,
                      ],
                      [
                        "Target CPU user + system (ms)",
                        (r: BenchmarkRun) =>
                          r.target
                            ? r.target.cpuUserMs + r.target.cpuSystemMs
                            : undefined,
                      ],
                      [
                        "Target sampled peak RSS (MiB)",
                        (r: BenchmarkRun) =>
                          r.target
                            ? r.target.sampledPeakRssBytes / 1024 / 1024
                            : undefined,
                      ],
                      [
                        "Target heap at end (MiB)",
                        (r: BenchmarkRun) =>
                          r.target
                            ? r.target.heapUsedEndBytes / 1024 / 1024
                            : undefined,
                      ],
                      [
                        "Load-generator CPU (ms)",
                        (r: BenchmarkRun) =>
                          r.load.cpuUserMs + r.load.cpuSystemMs,
                      ],
                    ].map(([label, get]) => (
                      <tr key={label as string}>
                        <th>
                          {label as string}
                          <small>Mean · range</small>
                        </th>
                        {(["before", "after"] as const).map((v) => {
                          const values = data.runs
                            .filter((r) => r.variant === v)
                            .map(get as (r: BenchmarkRun) => number | undefined)
                            .filter((v): v is number => v !== undefined);
                          const s = stats(values);
                          return (
                            <td key={v}>
                              {fmt(s?.mean)}
                              <small>
                                {fmt(s?.min)}–{fmt(s?.max)}
                              </small>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr>
                      <th>Received response payload bytes</th>
                      {(["before", "after"] as const).map((v) => (
                        <td key={v}>
                          {data.runs
                            .filter((r) => r.variant === v)
                            .reduce((n, r) => n + r.load.payloadBytes, 0)
                            .toLocaleString()}
                          <small>
                            HTTP bodies only, not network wire bytes
                          </small>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="subtle">
                CPU time is not energy. Memory values cover the entire
                application process and can vary with garbage collection; they
                do not isolate the cache. Load-generator resource use is
                measured separately and excluded from the carbon scenario.
              </p>
              <details>
                <summary>All repetitions, including failures</summary>
                <div
                  className="table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="Benchmark repetitions"
                >
                  <table>
                    <thead>
                      <tr>
                        <th>Pair / order</th>
                        <th>Version</th>
                        <th>Success / fail</th>
                        <th>Elapsed ms</th>
                        <th>CPU user / system ms</th>
                        <th>RSS start / end / sampled peak MiB</th>
                        <th>Scenario gCO₂e / 1,000</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.runs.map((r, i) => (
                        <tr key={i}>
                          <td>
                            {r.pair + 1} · {r.position}
                          </td>
                          <td>
                            {r.variant}
                            {r.error && <small>{r.error}</small>}
                          </td>
                          <td>
                            {r.load.successful} / {r.load.failed}
                            <small>
                              Warm-up {r.warmup.successful} / {r.warmup.failed}
                            </small>
                          </td>
                          <td>{fmt(r.target?.elapsedMs)}</td>
                          <td>
                            {fmt(r.target?.cpuUserMs)} /{" "}
                            {fmt(r.target?.cpuSystemMs)}
                          </td>
                          <td>
                            {r.target
                              ? `${mib(r.target.rssStartBytes)} / ${mib(r.target.rssEndBytes)} / ${mib(r.target.sampledPeakRssBytes)}`
                              : "—"}
                          </td>
                          <td>
                            {r.target
                              ? fmt(
                                  scenarioEstimate(
                                    r.target.elapsedMs,
                                    r.load.successful,
                                    r.scenario,
                                  ).gramsPer1000,
                                )
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
            <section className="card">
              <h2>Code improvements and supporting evidence</h2>
              <p>
                <strong>Potential improvement:</strong> static analysis
                identifies repeated reference-file reading and parsing. It does
                not measure emissions.
              </p>
              <p>
                <strong>Observed resource difference:</strong>{" "}
                {summary.blocker
                  ? "This workload does not support a valid before/after claim; inspect failures and compatibility above."
                  : (() => {
                      const before = stats(
                        data.runs
                          .filter((r) => r.variant === "before" && r.target)
                          .map(
                            (r) => r.target!.cpuUserMs + r.target!.cpuSystemMs,
                          ),
                      )!;
                      const after = stats(
                        data.runs
                          .filter((r) => r.variant === "after" && r.target)
                          .map(
                            (r) => r.target!.cpuUserMs + r.target!.cpuSystemMs,
                          ),
                      )!;
                      return `Mean target CPU time was ${fmt(before.mean)} ms before and ${fmt(after.mean)} ms after. That is ${after.mean < before.mean ? "lower" : after.mean > before.mean ? "higher" : "unchanged"} in these runs. Review duration, memory and variability too; this is not a general causal guarantee.`;
                    })()}
              </p>
              <p>
                <strong>Estimated carbon difference:</strong> the configured
                scenario converts measured batch duration into allocated energy
                and CO₂e. It does not turn a static finding or CPU time into
                measured electricity.
              </p>
              <p>
                Both plain JavaScript Express applications return the same{" "}
                {data.responsePayloadBytes.toLocaleString()}-byte JSON payload
                from <code>GET /reference-data</code>. Every successful
                benchmark response matched the expected body and HTTP status.
              </p>
              {data.sources.before.scan.findings
                .filter((f) => f.ruleId === "request-reference-json")
                .map((f) => (
                  <article className="finding" key={f.fingerprint}>
                    <h3>{f.title}</h3>
                    <code>
                      before/{f.file}:{f.line}
                    </code>
                    <p>{f.explanation}</p>
                    <p>
                      <strong>Suggested fix:</strong> {f.remediation}
                    </p>
                    <p>
                      <strong>Trade-offs:</strong> {f.tradeoffs}
                    </p>
                  </article>
                ))}
              {!data.sources.before.scan.findings.some(
                (f) => f.ruleId === "request-reference-json",
              ) && (
                <p className="notice">
                  The saved source scan did not identify the expected
                  reference-data pattern. Review the source and scan coverage
                  before drawing conclusions.
                </p>
              )}
              <div className="two-col sample-code">
                {(["before", "after"] as const).map((v) => (
                  <details key={v} open>
                    <summary>
                      {v === "before"
                        ? "Before: read and parse per request"
                        : "After: reuse parsed data"}
                    </summary>
                    <pre>
                      <code>{data.sources[v].code}</code>
                    </pre>
                  </details>
                ))}
              </div>
              <p>
                The cache holds one parsed copy per process. It stays unchanged
                until the process restarts, so restart after updating the
                reference file. This trades retained memory and potentially
                stale data for less repeated work. The endpoint does not mutate
                the cached object.
              </p>
            </section>
            <section className="card">
              <h2>Calculation and measurement details</h2>
              <details>
                <summary>How this was calculated</summary>
                <p>
                  <strong>Model:</strong> {data.scenario.model} v
                  {data.scenario.version}. {data.scenario.formulaNote}
                </p>
                <pre>
                  kWh = assumed watts × measured target elapsed milliseconds /
                  3,600,000,000{"\n"}gCO₂e = kWh × electricity intensity
                  (gCO₂e/kWh){"\n"}gCO₂e per 1,000 = gCO₂e × 1,000 / successful
                  requests
                </pre>
                <p>
                  <strong>
                    Power input ({data.scenario.powerProvenance}):
                  </strong>{" "}
                  {data.scenario.allocatedPowerWatts} W.{" "}
                  {data.scenario.powerSource}
                </p>
                <p>
                  <strong>
                    Electricity factor ({data.scenario.factorProvenance}):
                  </strong>{" "}
                  {data.scenario.carbonIntensityGramsPerKWh} gCO₂e/kWh.{" "}
                  {data.scenario.factorSource} Date: {data.scenario.factorDate}.
                  Region: {data.scenario.factorRegion}.
                </p>
                <p>
                  Formula reference: {data.scenario.formulaSource}. This source
                  documents dimensional operational accounting; the power and
                  electricity factors here are illustrative assumptions, not
                  values supplied by that source.
                </p>
                <p>
                  <strong>Boundary:</strong> {data.scenario.boundary}.
                  Allocation is assumed to end with the batch. If a service
                  remains provisioned and idle, shorter request processing need
                  not reduce its electricity consumption.
                </p>
                <ul>
                  {data.scenario.exclusions.map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
                <p>
                  Not a whole-lifecycle footprint or complete SCI assessment.
                  CO2.js is not applied automatically here: these are loopback
                  HTTP body bytes, not measured internet delivery. Its
                  web-transfer boundary is inapplicable to this workload.
                  Existing advanced transfer diagnostics remain separate; never
                  sum overlapping estimates.
                </p>
              </details>
              <details>
                <summary>Environment, provenance and reproducibility</summary>
                <p>
                  {data.environment.cpuModel} · {data.environment.logicalCpus}{" "}
                  logical CPUs · {mib(data.environment.totalMemoryBytes)} MiB
                  memory · {data.environment.platform}{" "}
                  {data.environment.release} / {data.environment.arch} · Node{" "}
                  {data.environment.node} · Express {data.environment.express}
                </p>
                <p>{data.environment.energyCapability}</p>
                <p>{data.environment.measurementBoundary}</p>
                <ul>
                  {data.environment.limitations.map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
                <p>
                  All repetitions are retained; no best-run selection. Range and
                  population standard deviation describe observed variability,
                  not confidence intervals. Code/data hashes, configuration, raw
                  measurements and model assumptions are saved in the
                  downloadable benchmark JSON.
                </p>

                <p>
                  The analysis worker runs only the trusted bundled before/after
                  samples. Uploaded source cannot enter its execution path.
                  Ordinary source scans never inherit these numbers.
                </p>
              </details>
            </section>
          </>
        )
      )}
    </>
  );
}
