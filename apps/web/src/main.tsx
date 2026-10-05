import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api.ts";
import { LegacyApp } from "./legacy.tsx";
import type { TrafficResult } from "../../../packages/shared/src/traffic.ts";
import type { Finding } from "../../../packages/shared/src/index.ts";
import "./style.css";
const n = (x: number) =>
  x.toLocaleString(undefined, { maximumSignificantDigits: 3 });
const carbon = (g: number | null) =>
  g === null
    ? "Unavailable"
    : g === 0
      ? "0 g CO₂e"
      : g < 0.001
        ? `${n(g * 1e6)} µg CO₂e`
        : g < 1
          ? `${n(g * 1000)} mg CO₂e`
          : g >= 1000
            ? `${n(g / 1000)} kg CO₂e`
            : `${n(g)} g CO₂e`;
const bytes = (b: number) =>
  b < 1000 ? `${n(b)} B` : b < 1e6 ? `${n(b / 1000)} kB` : `${n(b / 1e6)} MB`;
function Illustration() {
  const [paused, setPaused] = useState(false);
  return (
    <details className="traffic-illustration">
      <summary>See the illustration</summary>
      <div className={paused ? "paused transfer-flow" : "transfer-flow"}>
        <span>Request</span>
        <b aria-hidden="true">→</b>
        <span>Response data</span>
        <b aria-hidden="true">→</b>
        <span>Estimated CO₂e</span>
      </div>
      <p className="subtle">
        Illustration, not a live trace. CO2.js uses byte evidence, not source
        lines.
      </p>
      <button
        className="text-link"
        aria-pressed={paused}
        onClick={() => setPaused(!paused)}
      >
        {paused ? "Resume illustration" : "Pause illustration"}
      </button>
    </details>
  );
}
function Result({ record }: { record: any }) {
  const r = record.result,
    s = r.sample;
  const traffic: TrafficResult | null = r.traffic;
  const mean = (v: TrafficResult[], key: "grams" | "recordedBytes") =>
    v.reduce((a, b) => a + (b[key] ?? 0), 0) / v.length;
  const before = s ? mean(s.before, "grams") : 0,
    after = s ? mean(s.after, "grams") : 0;
  const beforeBytes = s ? mean(s.before, "recordedBytes") : 0,
    afterBytes = s ? mean(s.after, "recordedBytes") : 0;
  const allFindings: Finding[] = s ? s.findings : (r.source?.findings ?? []);
  const findings = allFindings.filter(
    (f) =>
      !(
        f.ruleId === "sync-fs-handler" &&
        allFindings.some(
          (other) =>
            other.ruleId === "request-reference-json" &&
            other.file === f.file &&
            other.line === f.line,
        )
      ),
  );
  const keyLine = s
    ? s.beforeCode
        .split("\n")
        .findIndex((l: string) => l.includes("app.get('/products',")) + 1
    : 0;
  return (
    <section className="card eco-result" aria-label="EcoLens report">
      <div className="section-title">
        <h2>Your result</h2>
        <a href={"/api/eco/results/" + record.id + "/export"}>
          Download report
        </a>
      </div>
      {s ? (
        <>
          <p className="subtle">
            Sample application · complete catalogue and order-review journey
          </p>
          <h3>Estimated CO₂e for the sample transfer scenario</h3>
          <div className="eco-comparison">
            <div>
              <span>Before</span>
              <strong data-testid="carbon-before">{carbon(before)}</strong>
              <small>{bytes(beforeBytes)} recorded response bytes</small>
            </div>
            <div>
              <span>Improved</span>
              <strong data-testid="carbon-after">{carbon(after)}</strong>
              <small>{bytes(afterBytes)} recorded response bytes</small>
            </div>
          </div>
          <p>
            {after < before
              ? "Lower estimate"
              : after > before
                ? "Higher estimate"
                : "Unchanged estimate"}
            : {carbon(Math.abs(after - before))} absolute difference
            {before > 0
              ? ` (${n(Math.abs((after - before) / before) * 100)}%)`
              : ""}
            . Mean per complete journey across three runs per version.
          </p>
          <p>
            All 12 products and required business fields were checked, along
            with product detail, order lines/total, reference data and
            availability.{" "}
            {s.journeys.reduce((a: number, j: any) => a + j.successful, 0)}{" "}
            successful measured requests;{" "}
            {s.journeys.reduce((a: number, j: any) => a + j.failed, 0)}{" "}
            failures.
          </p>
        </>
      ) : traffic?.grams !== null && traffic ? (
        <>
          <h3>Estimated CO₂e for recorded traffic</h3>
          <strong className="eco-total" data-testid="traffic-carbon">
            {carbon(traffic.grams)}
          </strong>
          <p>
            <b>{bytes(traffic.recordedBytes)}</b> recorded response bytes ·{" "}
            <b>{traffic.includedRequests}</b> included requests
          </p>
        </>
      ) : (
        <p className="notice">
          {traffic
            ? "No supported recorded byte evidence was found. Export a HAR that includes encoded response body sizes."
            : "Add a network recording to estimate transfer-related emissions."}
        </p>
      )}
      {traffic && !s && (
        <p className="subtle">
          {traffic.includedRequests} of {traffic.evidence.entries.length}{" "}
          requests included. {traffic.excludedRequests} excluded (cached,
          failed, unknown or invalid sizes). {traffic.failedResponses}{" "}
          failed/network-error or HTTP error responses recorded; known HTTP
          error bodies are included.
        </p>
      )}
      {traffic?.grams !== null && traffic && (
        <>
          <details>
            <summary>
              {s ? "Request breakdown" : "Recorded request breakdown"}
            </summary>
            <p className="subtle">
              {s
                ? "Mean journey values; client-facing response bodies only."
                : "Requests are numbered in HAR order. URLs, headers, cookies and bodies are discarded; no endpoint-to-source mapping is inferred."}
            </p>
            <div
              className="table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Request contributions"
            >
              <table>
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Recorded bytes</th>
                    {s && <th>Improved bytes</th>}
                    <th>Estimated contribution{s ? " (improved)" : ""}</th>
                  </tr>
                </thead>
                <tbody>
                  {traffic.contributions.slice(0, 20).map((e, i) => (
                    <tr key={i}>
                      <td>
                        {e.label}
                        {!s && ` · ${e.method} · HTTP ${e.status}`}
                      </td>
                      <td>{bytes(e.bytes)}</td>
                      {s && (
                        <td>
                          {bytes(
                            s.after[0].contributions.find(
                              (a: any) => a.label === e.label,
                            )?.bytes ?? 0,
                          )}
                        </td>
                      )}
                      <td>
                        {carbon(
                          s
                            ? (s.after[0].contributions.find(
                                (a: any) => a.label === e.label,
                              )?.grams ?? 0)
                            : e.grams,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {traffic.contributions.length > 20 && (
              <p>
                Largest 20 responses shown; all sanitised evidence is in the
                report.
              </p>
            )}
          </details>
          <Illustration />
        </>
      )}
      <h3>Main improvement opportunities</h3>
      {traffic?.includedRequests ? (
        <p>
          Review the largest responses for unused fields, suitable pagination
          and redundant downloads. Check polling frequency; use compression or
          caching where the client’s freshness and functionality requirements
          permit.
        </p>
      ) : null}
      {s && (
        <div className="eco-finding">
          <b>Select fields needed by the catalogue view</b>
          <p>
            The recorded list responses contain descriptions, supplier and
            inspection fields that this task does not use. The improved handler
            returns the same 12 identities, names, prices and categories across
            the same pages; complete details remain available on the detail
            endpoint.
          </p>
          <code>server.js:{keyLine} · GET /products</code>
          <p className="subtle">
            Explicit mapping for the trusted sample only. These are
            endpoint-level bytes, not emissions assigned to this source line.
            Clients needing every field may make extra detail requests and lose
            this benefit.
          </p>
          <details>
            <summary>Compare the source</summary>
            <div className="two-col sample-code">
              <div>
                <h3>Before</h3>
                <pre>
                  <code>{s.beforeCode}</code>
                </pre>
              </div>
              <div>
                <h3>Improved</h3>
                <pre>
                  <code>{s.afterCode}</code>
                </pre>
              </div>
            </div>
          </details>
        </div>
      )}
      {findings.map((f, i) => (
        <article className="eco-finding" key={i}>
          <b>{f.title}</b>
          <p>
            <code>
              {f.file}:{f.line}
            </code>{" "}
            · {f.confidence} confidence
          </p>
          <p>{f.explanation}</p>
          <p>
            <strong>Suggested fix:</strong> {f.remediation}
          </p>
          <small>
            Potential resource inefficiency — carbon impact not quantified.
          </small>
          <details>
            <summary>Trade-offs and verification</summary>
            <p>{f.tradeoffs}</p>
            <p>{f.verification}</p>
          </details>
        </article>
      ))}
      {r.source && findings.length === 0 && (
        <p>No matching patterns within the scanner’s limited coverage.</p>
      )}
      {r.source && (
        <details>
          <summary>Source coverage</summary>
          <p>
            {r.source.coverage.status} coverage ·{" "}
            {r.source.coverage.analysed.length} files analysed. No source is
            executed.
          </p>
          <pre>{JSON.stringify(r.source.coverage, null, 2)}</pre>
        </details>
      )}
      <details>
        <summary>How this was calculated</summary>
        <p>
          CO2.js 0.18.0 · Sustainable Web Design v4 · perByte(bytes, false).
          Global bundled defaults; no green-hosting claim or external lookups.
          Bytes are a proxy for data-centre, network and user-device use plus
          embodied infrastructure. This is an estimate, not measured electricity
          or the complete production application footprint.
        </p>
        <p>
          {s
            ? "The same seven-request journey runs three times per version, with a full warm-up and concurrency one. We collect uncompressed HTTP response bodies, excluding headers, requests and the internal mock-service hop. Localhost traffic is used as a web-transfer reference scenario, not calibrated evidence of Airbus network emissions."
            : "We include valid nonnegative response.bodySize values from HAR 1.1/1.2. Unknown (-1/missing), invalid, explicitly cached/service-worker and network-failed entries are excluded. Decoded content.size/text, session totals, headers and request bytes are never substituted. Known HTTP error bodies remain included. Coverage can be incomplete; zeros are accepted only when explicitly recorded."}
        </p>
        <p>
          Caching file reads does not lower this estimate if response bytes
          remain unchanged. Source findings and traffic estimates are separate
          paths; no generic source-line carbon attribution is attempted.
        </p>
        <p className="subtle">
          CO2.js: Green Web Foundation (Apache-2.0). SWD model: Sustainable Web
          Design; bundled global intensity based on Ember (CC BY-SA 4.0). Model
          documentation checked 2 October 2026. Regional Electricity Maps
          datasets are not used.
        </p>
        {s && (
          <p>
            Recorded byte ranges per journey: before{" "}
            {bytes(Math.min(...s.before.map((t: any) => t.recordedBytes)))}–
            {bytes(Math.max(...s.before.map((t: any) => t.recordedBytes)))},
            improved{" "}
            {bytes(Math.min(...s.after.map((t: any) => t.recordedBytes)))}–
            {bytes(Math.max(...s.after.map((t: any) => t.recordedBytes)))}. All
            raw runs and task checks are preserved in the export.
          </p>
        )}
        {traffic && (
          <p>
            Excluded evidence:{" "}
            {["missing", "invalid", "cached", "failed"]
              .map(
                (reason) =>
                  `${reason}: ${traffic.evidence.entries.filter((e) => e.reason === reason).length}`,
              )
              .join(" · ")}
            .
          </p>
        )}
      </details>
    </section>
  );
}
function EcoLens() {
  const [page, setPage] = useState("home"),
    [source, setSource] = useState<File | null>(null),
    [har, setHar] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [id, setId] = useState<string | null>(null),
    [record, setRecord] = useState<any>(null),
    [saved, setSaved] = useState<any[]>([]),
    [info, setInfo] = useState<any>(null);
  useEffect(() => {
    void api("/eco/info")
      .then(setInfo)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (page !== "use") return;
    const c = new AbortController();
    void api("/eco/results", { signal: c.signal })
      .then(setSaved)
      .catch(() => {});
    return () => c.abort();
  }, [page, id, record?.status]);
  useEffect(() => {
    if (!id || page !== "use") return;
    const c = new AbortController();
    const load = async () => {
      try {
        const r = await api(
          "/eco/results/" + id,
          { signal: c.signal },
          "load this analysis",
        );
        if (!c.signal.aborted) {
          setRecord(r);
          setError("");
        }
      } catch (e) {
        if (!c.signal.aborted) setError((e as Error).message);
      }
    };
    void load();
    const t = setInterval(() => void load(), 700);
    return () => {
      c.abort();
      clearInterval(t);
    };
  }, [id, page]);
  async function start(example = false) {
    setBusy(true);
    setError("");
    setPage("use");
    try {
      let r;
      if (example)
        r = await api(
          "/eco/example",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          },
          "start the Express example",
        );
      else {
        const f = new FormData();
        if (source) f.append("source", source);
        if (har) f.append("har", har);
        r = await api(
          "/eco/analyse",
          { method: "POST", body: f },
          "analyse these files",
        );
      }
      setRecord(null);
      setId(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const navigate = (p: string) => {
    setPage(p);
    setError("");
  };
  if (page === "advanced")
    return (
      <>
        <div className="legacy-banner">
          <button onClick={() => navigate("use")}>Back to EcoLens</button>{" "}
          Advanced / historical tools. Legacy compute scenarios keep their
          original meaning.
        </div>
        <LegacyApp />
      </>
    );
  return (
    <div className="shell eco-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("home");
          }}
        >
          <img
            src="/airbus-wordmark.svg"
            width="133"
            height="24"
            alt="Airbus"
          />
          <span>EcoLens</span>
        </a>
        <nav aria-label="Main navigation">
          {[
            ["home", "Home"],
            ["use", "Use EcoLens"],
            ["how", "How it works"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={"nav" + (page === key ? " active" : "")}
              aria-current={page === key ? "page" : undefined}
              onClick={() => navigate(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <b>EcoLens Airbus</b>
          <span className="breadcrumb">
            Understand your application’s digital carbon impact.
          </span>
        </header>
        <main>
          {page === "home" && (
            <>
              <h1>EcoLens Airbus</h1>
              <p>Understand your application’s digital carbon impact.</p>
              <section className="card eco-home">
                <h2>What is Green IT?</h2>
                <p>
                  Reducing the environmental impact of technology by using
                  computing, data transfer, storage, and hardware more
                  efficiently.
                </p>
                <h2>What does EcoLens do?</h2>
                <p>
                  Uses CO2.js to estimate emissions associated with application
                  data transfer and checks source code for potential resource
                  inefficiencies.
                </p>
                <h2>How do I use it?</h2>
                <p>
                  Try the working Express example, upload source code for
                  improvement suggestions, or upload a network recording for a
                  traffic-based carbon estimate.
                </p>
                <div className="actions">
                  <button className="primary" onClick={() => navigate("use")}>
                    Use EcoLens
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void start(true)}
                  >
                    Try Express example
                  </button>
                </div>
              </section>
              <p>
                Running software uses hardware and electricity. Unnecessary work
                and data transfers can increase resource use and associated
                emissions.
              </p>
            </>
          )}
          {page === "use" && (
            <>
              <h1>Use EcoLens</h1>
              <p>Upload source, a network recording, or both.</p>
              <section className="card">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void start();
                  }}
                >
                  <div className="two-col">
                    <label>
                      Source code (optional)
                      <input
                        type="file"
                        accept=".js,.ts,.jsx,.tsx,.zip"
                        onChange={(e) => setSource(e.target.files?.[0] ?? null)}
                      />
                      <small>
                        Source code helps locate improvement opportunities.
                        Single file: 1 MiB; ZIP: 10 MiB.
                      </small>
                    </label>
                    <label>
                      Network recording (optional)
                      <input
                        type="file"
                        accept=".har"
                        onChange={(e) => setHar(e.target.files?.[0] ?? null)}
                      />
                      <small>
                        A network recording supplies traffic data for the carbon
                        estimate. HAR: 10 MiB.
                      </small>
                    </label>
                  </div>
                  <div className="actions">
                    <button
                      className="primary"
                      disabled={busy || (!source && !har)}
                    >
                      {busy ? "Starting…" : "Analyse"}
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => void start(true)}
                    >
                      Try Express example
                    </button>
                    <a href="/api/eco/server.js">Download sample server.js</a>
                    <a href="/api/eco/example.zip">Example ZIP & setup</a>
                  </div>
                </form>
                <details>
                  <summary>How to record traffic</summary>
                  <ol>
                    <li>Open browser developer tools.</li>
                    <li>Open Network and record the user journey.</li>
                    <li>
                      Export a HAR, using sanitised export when available.
                    </li>
                    <li>Upload it here.</li>
                  </ol>
                  <p>
                    EcoLens discards URLs, headers, cookies and bodies. It keeps
                    only numbered requests, methods, statuses and byte evidence.
                    Requests in the HAR are never executed.
                  </p>
                </details>
              </section>
              {error && (
                <p className="error" role="alert">
                  {error} Retry the action above.
                </p>
              )}
              {record && !["completed", "failed"].includes(record.status) && (
                <div className="card" role="status">
                  <p>
                    {{
                      queued: "Waiting to analyse",
                      reading: "Reading evidence",
                      checking: "Checking source",
                      running: "Running the trusted example",
                      estimating: "Estimating traffic impact",
                    }[record.status as string] ?? "Analysing"}
                  </p>
                  <progress aria-label="Analysis in progress" />
                </div>
              )}
              {record?.status === "failed" && (
                <p className="error" role="alert">
                  {record.error} Use Analyse or Try Express example to retry.
                </p>
              )}
              {record?.status === "completed" && <Result record={record} />}
              <details>
                <summary>Saved results & advanced tools</summary>
                {saved.length > 0 && (
                  <label>
                    Saved EcoLens result
                    <select
                      value={id ?? ""}
                      onChange={(e) => {
                        setRecord(null);
                        setId(e.target.value);
                      }}
                    >
                      <option value="" disabled>
                        Select a result
                      </option>
                      {saved.map((r) => (
                        <option key={r.id} value={r.id}>
                          {new Date(r.createdAt).toLocaleString()} ·{" "}
                          {r.kind === "sample"
                            ? "Express sample"
                            : "Uploaded evidence"}{" "}
                          · {r.status}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  className="text-link"
                  onClick={() => navigate("advanced")}
                >
                  Historical records, CLI and report import
                </button>
              </details>
            </>
          )}
          {page === "how" && (
            <>
              <h1>How it works</h1>
              <section className="card">
                <h2>Read the code</h2>
                <p>
                  {info
                    ? `${info.parser.package} ${info.parser.version}`
                    : "Babel parser (loading installed version…)"}{" "}
                  identifies functions, loops, calls, imports and source
                  locations. Our custom rules flag selected potentially
                  inefficient patterns. The parser does not produce carbon
                  numbers.
                </p>
                <h2>Read the traffic</h2>
                <p>
                  Recorded response bytes come from supported HAR fields or the
                  bundled Express journey. Source-only analysis can find
                  opportunities without traffic, but cannot produce a traffic
                  estimate.
                </p>
                <h2>Estimate the impact</h2>
                <p>
                  CO2.js {info?.model.packageVersion ?? "0.18.0"} uses the
                  explicitly selected Sustainable Web Design v4 model. It
                  receives byte evidence—not the AST or source code. Results are
                  estimates for the recorded traffic, not measured electricity
                  or the complete application footprint.
                </p>
                <details>
                  <summary>Coverage, model and tool boundaries</summary>
                  <p>
                    Six narrow existing rules cover awaited fetch in loops,
                    short recurring intervals, synchronous file calls in Express
                    handlers, repeated fixed JSON parsing, request-time
                    reference JSON and React timer cleanup. CommonJS wrappers,
                    dynamic request sizes and database row/query frequency are
                    not inferred from names. Node/React support is limited to
                    these patterns; Angular/Java analysers are not supported.
                  </p>
                  <p>
                    HAR support uses encoded response.bodySize, never decoded
                    text size. Missing or excluded requests make coverage
                    incomplete. Localhost/intranet inputs use a web-model
                    reference scenario, not calibrated evidence of Airbus
                    network emissions. Generic HAR request labels are
                    anonymised; no line-level attribution is guessed.
                  </p>
                  <p>
                    SWD models data-centre, network and user-device use plus
                    embodied infrastructure through a byte proxy. CO2.js is by
                    Green Web Foundation (Apache-2.0); the bundled
                    global-intensity source is Ember (CC BY-SA 4.0). No regional
                    Electricity Maps data or external hosting checks are used.
                  </p>
                </details>
              </section>
              <p>
                EcoLens is not a replacement for SonarQube, Checkmarx, or
                ESLint. Some findings may overlap. Its purpose is to bring
                selected efficiency findings and CO2.js traffic estimates into
                one simple workflow.
              </p>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<EcoLens />);
