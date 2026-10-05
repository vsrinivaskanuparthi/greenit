# Security and privacy

This is a single-user local demonstration with no authentication, roles or multi-user isolation. It is not approved for sensitive/company source or production deployment. Only synthetic source is supplied. Do not expose the service to a LAN or public network.

## Existing controls

- Bind to 127.0.0.1 by default. Validate Host against loopback names, reject foreign Origin and cross-site fetch metadata. Same-origin API and local assets. CSP restricts scripts/connections/assets; object embedding and framing are disabled.
- Strict shared report validation; 10 MiB file upload and 12 MiB JSON HTTP body limit; paths must be relative and safe. Imported text remains text through React, not HTML. Imported provenance is visible and unverified.
- In-memory ZIP ingress is bounded to two simultaneous uploads. Raw ZIP is stored with a generated UUID and restrictive permissions outside the web root. Original filenames never choose server paths.
- Streaming ZIP extraction rejects absolute/traversal/backslash/control-character paths, duplicate paths, symlinks, special-file modes, encrypted entries and inconsistent directory metadata. Exclusive output-file creation and fresh job directories prevent overwrite. Expanded byte limits are checked while streaming; metadata is not trusted as the sole limit. Nested archives are ordinary unsupported files and never recursively extracted.
- Limits: 10 MiB compressed, 50 MiB expanded, 3,000 entries, 1 MiB/file, twenty pending jobs, one worker and 45-second wall deadline. The worker invokes only owned scanner code, never uploaded installers, scripts, binaries or builds. Application dependencies are never installed during scans.
- Finally/parent-exit cleanup removes source after success and failure. Restart marks abandoned jobs interrupted/failed and removes orphan data. Stored reports persist; project deletion cascades results and removes associated temporary directories after active jobs finish.
- No source content is logged. Parser and worker errors are sanitised. Reports omit code excerpts, but relative filenames and user-entered report/measurement text can still be sensitive. Protect `.data/` and exported files accordingly.

## Boundaries of the prototype

Static scanning, upload content, comments, README text and imported fields are data, never agent instructions. The scanner reads files and parses ASTs; it does not evaluate code. The process boundary is for bounded work and reliability, not a production security sandbox. Babel, ZIP and native SQLite dependencies still require patching and independent review. Local files changing concurrently with traversal are outside the reproducible-snapshot model. Likely-secret filename filtering is not comprehensive secret detection.

The application contains no telemetry, analytics, external AI calls or public runtime API requests. Browser verification blocks unexpected origins. The CLI has no network client. **An enforceable future no-egress environment requires deployment-level network restrictions**; application design alone cannot prevent a compromised dependency from opening a connection. Supply-chain review and controlled dependency installation would also be necessary.

Project deletion removes live SQLite rows and files, not a forensic secure erase of database pages, WAL files, exports, backups or filesystem snapshots. Users control their own downloaded reports. Browser printing may create local PDF files outside application control.

A future approved internal deployment needs real access control, isolation, hardened workers, network policy, retention decisions, dependency/security review and operational ownership. These are roadmap items, not implied capabilities of this MVP.

## Branding and UI refinement

The official Airbus wordmark is a static local SVG copied unchanged from the public website (source and checksum in README). No external logo or font requests are made. Branding does not add official approval, authentication or production access controls. Deployment limitations remain unchanged even though development-status banners are no longer part of the user interface. API diagnostics omit request/response bodies, source content and schema values; only method, route template, status/error category or startup error code is recorded.

## Allowlisted browser demonstration workload

The only execution action is `POST /api/examples/express/analyse` with exactly `{"sample":"express-reference-v1"}`. Runtime/source paths, commands, workload parameters and extra fields are rejected. Existing Host/Origin/Fetch-Site protections apply. Direct starts are single-flight; recognised ZIP jobs are serialised by the same scheduler. ZIP and Express workers share one execution slot; no distributed queue is introduced.

`express_jobs` persists stages, failure messages, raw results, history and optional source-scan linkage. The scheduler forks a fixed application-owned worker outside the API request process. That worker verifies the trusted bundled manifest, invokes the existing allowlisted benchmark and enforces a 90-second overall watchdog. On POSIX, a dedicated process group allows the scheduler to kill the worker and all target descendants on timeout/shutdown. Parent IPC disconnect also terminates the worker group; target processes exit when their benchmark parent disconnects. Windows uses process termination/IPC disconnect rather than POSIX groups and has not been verified. Restart marks unfinished jobs failed; retry creates a new job. Failures retain available measurements without claiming a valid comparison.

Only fixed repository-owned `before/app.js` and `after/app.js` imports execute. The target requires IPC, rejects symlinked modules, accepts only literal before/after, inherits no Node execution flags, uses no shell and has a minimal environment. No scanned application dependency installation occurs. Trust the repository and provisioned dependencies; this allowlist is not an adversarial runtime sandbox.

For uploaded ZIPs, the existing bounded safe extractor runs first. Every extracted file path and SHA-256 must match `examples/express-reference/manifest.json`, with no extra or missing files; symlinks fail recognition. The manifest is loaded from the trusted repository, never from the upload. Matching project names or metadata are irrelevant. The scan and matching-job linkage commit atomically. Even for an exact match, only the bundled copy is executed; uploaded source is deleted through the existing success/failure cleanup. Modified/unrecognised uploads remain non-executing static scans and never receive generic example carbon values. Deletion of a linked project is blocked during active work and cascades its finished benchmark results.

Read APIs expose validated results, sample source and branded JSON export. Only the public bundled sample source is included in benchmark artifacts; ordinary reports still omit excerpts. Result rendering uses escaped React text. No remote factors, fonts, telemetry or hosting checks are used. Deployment-level network restrictions remain necessary for enforceable future no-egress operation. Existing SQLite results and the legacy terminal artifact remain intact.

## EcoLens upload and transfer workflow (current primary interface)

`POST /api/eco/analyse` accepts at most one source (.js/.ts/.jsx/.tsx/.zip) and one HAR via bounded multipart upload, two simultaneous requests. Source file limit 1 MiB, HAR/ZIP ingress 10 MiB each, HAR 5,000 entries. A strict projection reads HAR in memory and immediately discards URLs (including path/query/credentials), headers, cookies, bodies, timing/IP details and all other metadata. Raw HAR is never written to disk or logged; only request ordinal, allowlisted method, status, admitted encoded body size and exclusion reason are persisted. No request in a HAR is executed. JSON parsing is size bounded, not an evaluator.

New source uploads always follow the non-executing scanner, including downloaded sample ZIPs. Only the explicit Try Express example action starts fixed bundled `catalog-before`/`catalog-after` code, after manifest verification. It accepts an empty strict body, no executable paths/commands/options. The existing owned target runner is extended; the single worker scheduler is reused. Per-target and whole-job deadlines, process-group termination, IPC-disconnect handling and isolated temporary SQLite files bound execution. Temporary source/archive/databases are removed on success/failure/timeout; restart marks new incomplete jobs failed and clears their sanitised transient evidence. No scanned dependencies are installed. Legacy ZIP recognition/execution remains confined to its historical explicitly allowlisted sample behind advanced tools.

`eco_reports` is additive; old projects/scans/express_jobs and the terminal artifact are untouched. Completed EcoLens reports store no uploaded source text or raw HAR. Bundled public sample code is included only in sample results. Rendered text uses React escaping. Known HAR sizes can still be supplied inaccurately; they are recorded evidence, not independently verified network measurements. Local repository/dependencies must be trusted; this is no execution sandbox or production security certification. Existing localhost, CSP, Origin checks and no-egress deployment caveats continue to apply.
