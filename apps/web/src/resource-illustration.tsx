import { useState } from "react";
export function ResourceIllustration({ location }: { location?: string }) {
  const [paused, setPaused] = useState(false);
  return (
    <section
      className={"card resource-illustration" + (paused ? " paused" : "")}
    >
      <div className="section-title">
        <h2>How resource use relates to emissions — illustration.</h2>
        <button
          className="secondary"
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
        >
          {paused ? "Resume animation" : "Pause animation"}
        </button>
      </div>
      <p>
        This explains the relationship; it is not a live execution trace. Energy
        demand is inferred by the declared scenario, not measured by this
        animation.
      </p>
      <div
        className="flow-diagram"
        role="img"
        aria-label="A request reaches the Express handler, which performs file and CPU work. Running hardware needs energy; an electricity factor links energy to estimated CO2e."
      >
        {[
          "Request arrives",
          "Express handler",
          "File / CPU work",
          "Energy demand",
          "Estimated CO₂e",
        ].map((text, i) => (
          <div className={"flow-step step-" + i} key={text}>
            <svg viewBox="0 0 40 32" aria-hidden="true">
              <rect x="3" y="3" width="28" height="26" rx="4" />
              <path d="M9 12h16M9 20h10M32 16h7m-4-4 4 4-4 4" />
            </svg>
            <strong>{text}</strong>
          </div>
        ))}
      </div>
      <div className="two-col">
        <div>
          <h3>Before: repeated work</h3>
          <svg
            className="variant-flow"
            viewBox="0 0 420 64"
            role="img"
            aria-label="Every request repeats reading the file and parsing JSON before responding."
          >
            <path d="M62 32h24m-6-5 6 5-6 5M175 32h24m-6-5 6 5-6 5M290 32h24m-6-5 6 5-6 5" />
            <text x="3" y="36">
              Request
            </text>
            <rect
              className="repeat-work"
              x="90"
              y="12"
              width="83"
              height="40"
              rx="5"
            />
            <text x="99" y="36">
              Read file
            </text>
            <rect
              className="repeat-work"
              x="204"
              y="12"
              width="83"
              height="40"
              rx="5"
            />
            <text x="213" y="36">
              Parse JSON
            </text>
            <text x="319" y="36">
              Response
            </text>
          </svg>
          <p>
            Each request reads the same reference file and parses JSON, then
            serialises the response. {location && <code>{location}</code>}
          </p>
        </div>
        <div>
          <h3>After: reuse loaded data</h3>
          <svg
            className="variant-flow"
            viewBox="0 0 420 64"
            role="img"
            aria-label="After startup loads the cache, every request reuses it before responding."
          >
            <path d="M62 32h48m-6-5 6 5-6 5M270 32h44m-6-5 6 5-6 5" />
            <text x="3" y="36">
              Request
            </text>
            <rect
              className="reuse-work"
              x="115"
              y="12"
              width="150"
              height="40"
              rx="5"
            />
            <text x="135" y="36">
              Reuse cached data
            </text>
            <text x="319" y="36">
              Response
            </text>
          </svg>
          <p>
            Load and parse once at startup → reuse the object across requests →
            serialise each response. Restart after changing the file; caching
            retains memory and may serve stale data.
          </p>
        </div>
      </div>
      <p className="subtle">
        Avoidable work can increase resource use. The measured workload and
        configured scenario below determine the numeric results.
      </p>
    </section>
  );
}
