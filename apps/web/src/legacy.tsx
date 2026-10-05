import { SampleLauncher } from "./sample-launcher.tsx";
import { ExpressExample, CARBON_EXPLANATION } from "./express-example.tsx";
import { NewAnalysis } from "./new-analysis.tsx";
import { api } from "./api.ts";
import { CarbonSection, CarbonComparison } from "./carbon.tsx";
import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  compare,
  type Finding,
  type Report,
} from "../../../packages/shared/src/index.ts";
import "./style.css";
type Project = { id: string; name: string };
type Scan = {
  id: string;
  projectId: string;
  status: string;
  origin: string;
  createdAt: string;
  error?: string;
  report?: Report;
  findings?: number;
  files?: number;
  coverage?: string;
  synthetic?: boolean;
  exampleJobId?: string;
};
export function LegacyApp() {
  const [page, setPage] = useState("overview"),
    [projects, setProjects] = useState<Project[]>([]),
    [scans, setScans] = useState<Scan[]>([]),
    [selected, setSelected] = useState<Scan | null>(null),
    [error, setError] = useState(""),
    [workspaceError, setWorkspaceError] = useState(""),
    [retry, setRetry] = useState<(() => void) | null>(null),
    [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [exampleJob, setExampleJob] = useState<string | undefined>();
  const startExample = (id: string) => {
    setExampleJob(id);
    go("express");
  };
  const pageRef = useRef(page);
  pageRef.current = page;
  async function refresh(signal?: AbortSignal) {
    try {
      const [p, s] = await Promise.all([
        api("/projects", { signal }, "load projects"),
        api("/scans", { signal }, "load scans"),
      ]);
      if (signal?.aborted) return;
      setWorkspaceError("");
      setProjects(p);
      setScans(s);
      setLoading(false);
    } catch (e) {
      if (signal?.aborted) return;
      setWorkspaceError((e as Error).message);
      setLoading(false);
    }
  }
  useEffect(() => {
    if (page !== "overview" && page !== "comparison") return;
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => void refresh(controller.signal), 2000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [tick, page]);
  async function open(id: string) {
    const from = pageRef.current;
    try {
      const scan = await api("/scans/" + id, {}, "load this scan");
      if (pageRef.current !== from) return;
      setSelected(scan);
      if (scan.exampleJobId) {
        setExampleJob(scan.exampleJobId);
        setPage("express");
      } else setPage("details");
      setError("");
      setRetry(null);
    } catch (e) {
      if (pageRef.current !== from) return;
      setRetry(() => () => void open(id));
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (
      page !== "details" ||
      !selected ||
      ["completed", "failed"].includes(selected.status)
    )
      return;
    const t = setInterval(() => void open(selected.id), 700);
    return () => clearInterval(t);
  }, [page, selected?.id, selected?.status]);
  const go = (p: string) => {
    pageRef.current = p;
    setPage(p);
    setError("");
    setRetry(null);
  };
  const completed = scans.filter((s) => s.status === "completed");
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("overview");
          }}
          className="brand"
          aria-label="EcoLens Airbus overview"
        >
          <img
            src="/airbus-wordmark.svg"
            width="133"
            height="24"
            alt="Airbus"
          />
          <span>Green IT Insights</span>
        </a>
        <nav aria-label="Main navigation">
          {[
            ["overview", "◫", "Overview"],
            ["new", "＋", "Analyse application"],
            ["express", "⇄", "Results/comparison"],
            ["help", "ⓘ", "Help"],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              className={page === id ? "nav active" : "nav"}
              aria-current={page === id ? "page" : undefined}
              onClick={() => {
                if (id === "express") setExampleJob(undefined);
                go(id);
              }}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>EcoLens Airbus</span>
          <span className="breadcrumb">
            Engineering /{" "}
            {page === "new"
              ? "Analyse application"
              : page === "express"
                ? "Express application example"
                : page === "details"
                  ? "Scan details"
                  : page === "comparison"
                    ? "Comparison"
                    : page === "help"
                      ? "Help"
                      : "Overview"}
          </span>
        </header>
        <main>
          <div className="print-only print-brand">
            <strong>EcoLens Airbus</strong>
            <span>Analysis report</span>
          </div>
          {error && (
            <div role="alert" className="error">
              <span>{error}</span>
              {retry && (
                <button className="secondary" onClick={retry}>
                  Retry
                </button>
              )}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {(page === "overview" || page === "comparison") && workspaceError && (
            <div className="error" role="alert">
              <span>{workspaceError}</span>
              <button className="secondary" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}
          {page === "overview" && (
            <>
              <div className="page-heading">
                <div>
                  <h1>Overview</h1>
                  <p>
                    Review projects, scans and potential resource improvements.
                  </p>
                </div>
                <button className="primary" onClick={() => go("new")}>
                  Analyse application
                </button>
              </div>
              <SampleLauncher compact onStarted={startExample} />
              <div className="metrics">
                <Metric
                  label="Projects"
                  value={projects.length}
                  detail="In this workspace"
                />
                <Metric
                  label="Completed scans"
                  value={completed.length}
                  detail="ZIP scans & imported reports"
                />
                <Metric
                  label="Static findings"
                  value={completed.reduce((n, s) => n + (s.findings ?? 0), 0)}
                  detail="Across completed scans"
                />
              </div>
              <section className="card">
                <div className="section-title">
                  <div>
                    <h2>Recent analyses</h2>
                    <p>Trace each finding back to its source.</p>
                  </div>
                  <span className="subtle">{scans.length} scans</span>
                </div>
                {loading ? (
                  <p role="status">Loading local results…</p>
                ) : scans.length === 0 ? (
                  <div className="empty">
                    <div className="empty-icon">⌕</div>
                    <h3>No analyses yet</h3>
                    <p>
                      Upload source code or an existing scan report.
                      <br />
                      Results will appear here when analysis is complete.
                    </p>
                    <button className="secondary" onClick={() => go("new")}>
                      New analysis
                    </button>
                  </div>
                ) : (
                  <div
                    className="table-wrap"
                    tabIndex={0}
                    role="region"
                    aria-label="Recent analyses table, scroll horizontally on small screens"
                  >
                    <table>
                      <thead>
                        <tr>
                          <th>Project / scan</th>
                          <th>Source</th>
                          <th>Coverage</th>
                          <th>Findings</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scans.map((s) => (
                          <tr key={s.id}>
                            <td>
                              <button
                                className="text-link"
                                onClick={() => void open(s.id)}
                              >
                                {projects.find((p) => p.id === s.projectId)
                                  ?.name ?? "Project"}
                              </button>
                              <small>
                                {new Date(s.createdAt).toLocaleString()} ·{" "}
                                {s.id.slice(0, 8)}
                              </small>
                              {s.synthetic && (
                                <span className="tag">Sample data</span>
                              )}
                            </td>
                            <td>
                              {s.origin === "import"
                                ? "Imported report"
                                : "ZIP analysis"}
                            </td>
                            <td>
                              {s.files === undefined
                                ? "—"
                                : `${s.files} files · ${s.coverage}`}
                            </td>
                            <td>{s.findings ?? "—"}</td>
                            <td>
                              <Status status={s.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <div className="two-col">
                <section className="card info-card">
                  <h2>Understanding your results</h2>
                  <p>
                    Findings highlight code patterns worth reviewing. Open a
                    scan for file locations, suggested improvements and
                    verification advice.
                  </p>
                  <button className="text-link" onClick={() => go("help")}>
                    Learn about findings and estimates
                  </button>
                </section>
                <section className="card">
                  <h2>Projects</h2>
                  {projects.length === 0 ? (
                    <p>Your local projects will appear here.</p>
                  ) : (
                    projects.map((p) => (
                      <div className="project-row" key={p.id}>
                        <span>{p.name}</span>
                        <button
                          className="danger-link"
                          onClick={async () => {
                            if (
                              !confirm(
                                `Delete “${p.name}” and all its scans and saved inputs? This cannot be undone.`,
                              )
                            )
                              return;
                            try {
                              await api(
                                "/projects/" + p.id,
                                {
                                  method: "DELETE",
                                },
                                "delete this project",
                              );
                              setError("");
                              setRetry(null);
                              setTick((v) => v + 1);
                            } catch (e) {
                              setError((e as Error).message);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ))
                  )}
                </section>
              </div>
            </>
          )}
          {page === "new" && (
            <NewAnalysis
              onStarted={startExample}
              onDone={(id) => {
                void refresh();
                void open(id);
              }}
            />
          )}
          {page === "details" && selected && (
            <Details
              scan={selected}
              project={
                projects.find((p) => p.id === selected.projectId)?.name ??
                "Scan"
              }
              refresh={() => void open(selected.id)}
            />
          )}
          {page === "comparison" && (
            <Comparison scans={completed} projects={projects} />
          )}
          {page === "express" && (
            <>
              <div className="actions">
                <button className="secondary" onClick={() => go("comparison")}>
                  Compare source scans
                </button>
                <button className="secondary" onClick={() => go("new")}>
                  Analyse another application
                </button>
              </div>
              <ExpressExample jobId={exampleJob} onStarted={startExample} />
            </>
          )}
          {page === "help" && <Help />}
        </main>
      </div>
    </div>
  );
}
function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <section className="card metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}
function Status({ status }: { status: string }) {
  return <span className={"status " + status}>{status}</span>;
}
function FindingCard({ finding: f }: { finding: Finding }) {
  return (
    <article className="finding">
      <div className="finding-top">
        <span className={"tag " + f.severity}>{f.severity}</span>
        <span className="subtle">
          {f.confidence} confidence · {f.ruleId} v{f.ruleVersion}
        </span>
      </div>
      <h3>{f.title}</h3>
      <code>
        {f.file}:{f.line}:{f.column}
      </code>
      <p>{f.evidence}</p>
      <p>{f.explanation}</p>
      <details>
        <summary>Suggested improvement & verification</summary>
        <dl>
          <dt>Review this change</dt>
          <dd>{f.remediation}</dd>
          <dt>Trade-offs</dt>
          <dd>{f.tradeoffs}</dd>
          <dt>Verify the benefit</dt>
          <dd>{f.verification}</dd>
        </dl>
      </details>
    </article>
  );
}
function Details({
  scan: s,
  project,
  refresh,
}: {
  scan: Scan;
  project: string;
  refresh: () => void;
}) {
  const [severity, setSeverity] = useState("all"),
    [confidence, setConfidence] = useState("all"),
    [rule, setRule] = useState("all");
  const r = s.report;
  const matching =
    r?.findings.filter(
      (f) =>
        (severity === "all" || f.severity === severity) &&
        (confidence === "all" || f.confidence === confidence) &&
        (rule === "all" || f.ruleId === rule),
    ) ?? [];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="subtle">Scan {s.id.slice(0, 8)}</p>
          <h1>{project}</h1>
          <p>
            {new Date(s.createdAt).toLocaleString()} ·{" "}
            <Status status={s.status} />
          </p>
        </div>
        {r && (
          <div className="actions">
            <a className="secondary" href={"/api/scans/" + s.id + "/export"}>
              Export JSON ↓
            </a>
            <button
              className="secondary"
              onClick={() => {
                const closed = [
                  ...document.querySelectorAll("details:not([open])"),
                ];
                closed.forEach((el) => el.setAttribute("open", ""));
                window.print();
                closed.forEach((el) => el.removeAttribute("open"));
              }}
            >
              Print report
            </button>
          </div>
        )}
      </div>
      <div className="scan-labels">
        {r?.provenance.synthetic && (
          <span className="tag sample">Sample data</span>
        )}
        {s.origin === "import" && <span className="tag">Uploaded report</span>}
      </div>
      {s.origin === "import" && (
        <details className="report-info">
          <summary>Report information</summary>
          <p>
            Imported results are not independently verified. Original scan:{" "}
            {r?.createdAt} · scanner v{r?.tool.version} · origin{" "}
            {r?.provenance.origin}. Original provenance and coverage are
            preserved.
          </p>
        </details>
      )}
      {!r ? (
        <section className="card">
          <h2>
            {s.status === "failed"
              ? "Analysis could not complete"
              : "Analysis in progress"}
          </h2>
          <p role="status">
            {s.status === "failed"
              ? s.error
              : "Queued → validating archive → analysing source → completed"}
          </p>
        </section>
      ) : (
        <>
          <div className="metrics">
            <Metric
              label="Static findings"
              value={r.findings.length}
              detail="Potential opportunities to review"
            />
            <Metric
              label="Files analysed"
              value={r.coverage.analysed.length}
              detail={"Coverage: " + r.coverage.status}
            />
            <Metric
              label="Excluded / parser failures"
              value={
                r.coverage.excluded.length + r.coverage.parserErrors.length
              }
              detail={`${r.coverage.excluded.length} excluded · ${r.coverage.parserErrors.length} parser failures`}
            />
          </div>
          <section className="card">
            <h2>Scope & coverage</h2>
            <p>
              {r.detection.join(" · ") ||
                "No supported framework or language evidence found"}
            </p>
            {r.coverage.status === "none" && (
              <p className="error">
                No applicable analysis occurred. This scan cannot be called
                clean.
              </p>
            )}
            <p>
              Zero findings do not prove sustainability. Framework detection is
              evidence-based and does not imply comprehensive framework support.
            </p>
            <details>
              <summary>Files, exclusions & limitations</summary>
              <ul>
                {r.coverage.limitations.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
              <h3>Analysed files</h3>
              {r.coverage.analysed.map((f) => (
                <div key={f}>
                  <code>{f}</code>
                </div>
              ))}
              <h3>Excluded entries</h3>
              {r.coverage.excluded.map((v, i) => (
                <div key={i}>
                  <code>{v.file}</code> — {v.reason}
                </div>
              ))}
              <h3>Parser failures</h3>
              {r.coverage.parserErrors.length === 0 ? (
                <p>None recorded.</p>
              ) : (
                r.coverage.parserErrors.map((v, i) => (
                  <p key={i}>
                    {v.file}: {v.message}
                  </p>
                ))
              )}
            </details>
          </section>
          <section className="card">
            <div className="section-title">
              <h2>Findings to review</h2>
              <span className="subtle">No automatic source rewrites</span>
            </div>
            <p className="print-only">
              Filters: severity {severity}, confidence {confidence}, rule {rule}
              . Showing {matching.length} of {r.findings.length} findings.
            </p>
            <div className="filters">
              <label>
                Severity
                <select
                  aria-label="Severity"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                >
                  {["all", "high", "medium", "low"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Confidence
                <select
                  aria-label="Confidence"
                  value={confidence}
                  onChange={(e) => setConfidence(e.target.value)}
                >
                  {["all", "high", "medium"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                Rule
                <select
                  aria-label="Rule"
                  value={rule}
                  onChange={(e) => setRule(e.target.value)}
                >
                  <option>all</option>
                  {[...new Set(r.findings.map((f) => f.ruleId))].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </div>
            {matching.map((f) => (
              <FindingCard key={f.fingerprint} finding={f} />
            ))}
            {matching.length === 0 && (
              <p>
                No matching static patterns found within this scanner’s limited
                coverage.
              </p>
            )}
          </section>
          <p className="notice">
            Code analysis complete. Automatic carbon estimation is not yet
            supported for this application.
          </p>
          <details className="card">
            <summary>
              Advanced diagnostic tools — supplied carbon inputs
            </summary>
            <CarbonSection
              key={s.id}
              scanId={s.id}
              carbon={r.carbon}
              refresh={refresh}
            />
          </details>
        </>
      )}
    </>
  );
}
function Comparison({
  scans,
  projects,
}: {
  scans: Scan[];
  projects: Project[];
}) {
  const [project, setProject] = useState(""),
    [a, setA] = useState(""),
    [b, setB] = useState(""),
    [reports, setReports] = useState<[Report, Report] | null>(null),
    [error, setError] = useState("");
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Compare scans</h1>
          <p>Follow the findings across two revisions of the same project.</p>
        </div>
      </div>
      <section className="card">
        <div className="filters">
          <label>
            Project
            <select
              aria-label="Project"
              value={project}
              onChange={(e) => {
                setProject(e.target.value);
                setA("");
                setB("");
                setReports(null);
              }}
            >
              <option value="">Select project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {[
            ["Baseline", a, setA],
            ["Revised", b, setB],
          ].map(([label, value, setter]) => (
            <label key={label as string}>
              {label as string}
              <select
                aria-label={label as string}
                value={value as string}
                onChange={(e) => {
                  (setter as (v: string) => void)(e.target.value);
                  setReports(null);
                }}
              >
                <option value="">Select scan</option>
                {scans
                  .filter((s) => s.projectId === project)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.id.slice(0, 8)} ·{" "}
                      {new Date(s.createdAt).toLocaleString()} · {s.findings}{" "}
                      findings
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
        <button
          className="primary"
          disabled={!a || !b || a === b}
          onClick={async () => {
            try {
              const values = await Promise.all([
                api("/scans/" + a, {}, "load the baseline scan"),
                api("/scans/" + b, {}, "load the revised scan"),
              ]);
              setReports(values.map((v) => v.report) as [Report, Report]);
              setError("");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Compare scans
        </button>
        {error && <p role="alert">{error}</p>}
        <p className="notice">
          Fewer static findings do not automatically prove lower emissions.
          Fingerprints match rule version, relative path and AST structure;
          renames and changed expressions can appear as resolved and added.
        </p>
      </section>
      {reports && (
        <>
          <div className="metrics">
            {Object.entries(compare(...reports)).map(([label, items]) => (
              <Metric
                key={label}
                label={label}
                value={items.length}
                detail="Static finding matches"
              />
            ))}
          </div>
          {Object.entries(compare(...reports)).map(([label, items]) => (
            <section className="card" key={label}>
              <h2>{label}</h2>
              {items.length ? (
                items.map((f) => (
                  <FindingCard key={f.fingerprint} finding={f} />
                ))
              ) : (
                <p>No {label} findings.</p>
              )}
            </section>
          ))}
        </>
      )}
    </>
  );
}
function Help() {
  const sections = [
    ["Understanding software carbon", CARBON_EXPLANATION],
    [
      "Uploading source code",
      "In Analyse application, open Upload source code (ZIP), enter a project name and select a ZIP. An exact bundled sample match runs the trusted sample automatically; other uploads get static findings only. Exclude node_modules and build outputs before uploading. Source files are used for analysis and then deleted. Use Additional options to label example projects as sample data.",
    ],
    [
      "Scanning on your computer",
      "Open Advanced options under the ZIP section, then Scan on your computer for a command you can copy into a terminal. Replace the project path with your application folder and keep the output report outside that folder. The scanner reads your source without executing the application. Upload the resulting JSON to view its findings.",
    ],
    [
      "Uploading a scan report",
      "Under Advanced options, choose Upload scan report and select the JSON produced by the scanner. Default reports contain file paths and findings, not source-code excerpts. Uploaded reports are validated, but their findings are not independently verified. Existing sample-data labels and original scan details are preserved.",
    ],
    [
      "Understanding findings",
      "Findings identify code patterns worth reviewing. Severity indicates review priority; confidence describes how clearly the pattern was recognised, not how much energy it uses. Review each suggestion and its trade-offs, then verify the effect with a comparable workload. Fewer findings do not prove lower emissions.",
    ],
    [
      "Understanding carbon estimates",
      "The supported Express example collects workload evidence automatically and uses centrally configured illustrative assumptions for a scenario estimate. Software uses hardware and electricity; electricity supply has associated greenhouse-gas emissions. Actual production footprint depends on real usage and infrastructure. Other applications do not receive automatic carbon estimates. Advanced diagnostic tools retain the optional legacy calculators. The operational calculator uses supplied energy and electricity intensity; it excludes embodied hardware emissions. The CO2.js calculator models emissions from supplied application traffic. Results retain their input provenance, including sample values. The two boundaries may overlap, so do not add the results. Source code alone cannot establish emissions.",
    ],
    [
      "Supported technologies and limits",
      "Node.js and React analysis are supported within the implemented rule coverage for JavaScript, TypeScript, JSX and TSX. Angular and Java analysis are not yet supported. Coverage is partial: excluded files, parsing failures and unsupported areas appear in scan details. ZIP uploads are limited to 10 MiB, 50 MiB expanded, 3,000 entries and 1 MiB per file. JSON reports are limited to 10 MiB. Zero findings are not proof of sustainability.",
    ],
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Help</h1>
          <p>Choose a workflow and understand your results.</p>
        </div>
      </div>
      <section className="card help-card">
        {sections.map(([title, body], i) => (
          <details key={title} open={i === 0 ? true : undefined}>
            <summary>{title}</summary>
            <p>{body}</p>
          </details>
        ))}
      </section>
    </>
  );
}
