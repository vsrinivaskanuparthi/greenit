import { useEffect, useState } from "react";
import { api } from "./api.ts";
export function SampleLauncher({
  onStarted,
  compact = false,
}: {
  onStarted: (id: string) => void;
  compact?: boolean;
}) {
  const [source, setSource] = useState<{
      before: string;
      after: string;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    void api(
      "/examples/express/source",
      { signal: c.signal },
      "read the bundled source",
    )
      .then(setSource)
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  async function start() {
    setBusy(true);
    setError("");
    try {
      const r = await api(
        "/examples/express/analyse",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sample: "express-reference-v1" }),
        },
        "start the Express analysis",
      );
      onStarted(r.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card sample-launcher">
      <div className="section-title">
        <h2>Express reference-data application</h2>
        <span className="tag sample">Sample application</span>
      </div>
      <p>
        Analyse the bundled JavaScript source, run the same workload before and
        after caching, and compare measured resources with a carbon scenario. No
        measurement inputs required.
      </p>
      <button className="primary" onClick={() => void start()} disabled={busy}>
        {busy ? "Starting…" : "Analyse Express example"}
      </button>
      {!compact && (
        <>
          <p className="subtle">
            Automatic benchmarking uses only the trusted bundled copy. Modified
            or other uploaded projects receive code analysis only.
          </p>
          <details>
            <summary>Inspect the source being analysed</summary>
            {source ? (
              <div className="two-col sample-code">
                {(["before", "after"] as const).map((v) => (
                  <div key={v}>
                    <h3>
                      {v === "before"
                        ? "Before: read and parse each request"
                        : "After: load once; restart to refresh"}
                    </h3>
                    <pre>
                      <code>{source[v]}</code>
                    </pre>
                  </div>
                ))}
              </div>
            ) : (
              <p>
                Source preview unavailable. Analysis independently verifies the
                trusted files.
              </p>
            )}
          </details>
          <p>
            <a href="/api/examples/express/sample.zip">
              Download the bundled sample ZIP
            </a>{" "}
            — upload it below for the same automatic workflow. Every file must
            match the bundled manifest; the uploaded files are never executed.
          </p>
        </>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void start()}
          >
            Retry analysis
          </button>
        </div>
      )}
    </section>
  );
}
