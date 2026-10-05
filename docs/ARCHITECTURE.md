# Architecture

## Components

- `packages/shared`: strict Zod schema 1.0, report/measurement types, static comparison, compatibility checks, operational arithmetic and pinned local CO2.js wrapper. No source interpretation or HTTP calls.
- `packages/analysis-core`: bounded file traversal and Babel AST rules. Shared unchanged by CLI and worker. Dependency manifests give framework evidence but are never installed or executed.
- `packages/cli`: argument handling, in-place scanning and exclusive report creation. No network client or application execution.
- `apps/api`: Express on loopback; SQLite via better-sqlite3; JSON report validation; bounded multipart input; temporary per-job storage; one separate child worker at a time.
- `apps/web`: React/Vite with local styles and a locally stored, unchanged official Airbus wordmark. Overview, new analysis, details, comparison and help. Text is rendered through React escaping; there is no raw HTML rendering.
- `examples`: synthetic before/after source, reproducible ZIP/report generator and explicitly synthetic calculator inputs.

The built frontend is served by Express on the same origin as the API. No proxy, Redis, cloud storage, remote asset service or distributed queue is needed. Vite is a build tool; `npm run dev` runs the build first, then serves the frontend and API. TypeScript runs through Node's tsx loader locally.

## Persistence and worker lifecycle

SQLite stores projects and scans with foreign-key cascade deletion. Scan rows contain status, ingestion origin, timestamp, error and a validated JSON report. Project names group revisions within the single-user workspace. Imports are immediately completed with an `import` ingestion label; this does not change the report's original CLI/ZIP provenance.

ZIP submission creates a server-generated UUID directory under `.data/temporary/`, outside the web root, then persists a queued row. The process-local scheduler checks SQLite every 250 ms and forks one worker. The worker validates and streams extraction, marks analysing, invokes analysis-core and persists the result. It removes raw and extracted data in `finally`; the parent also cleans on exit/timeout. Startup marks abandoned queued/validating/analysing rows failed and removes orphan temporary data. Retry is an explicit new upload. Do not run two instances using the same database.

ZIP limits: 10 MiB compressed, 50 MiB expanded, 3,000 entries, 1 MiB per extracted file. At most two multipart uploads and twenty pending jobs are accepted. A 45-second parent deadline terminates a stuck child. There is no uploaded code execution path. Only the application's own worker code runs.

## Report contract

Reports include schema/tool versions, original UTC timestamp, CLI/ZIP origin, synthetic-source flag, language/framework evidence, analysed paths, excluded paths/reasons, parser errors, limitations and findings. Coverage is `partial` or `none`, never a universal clean bill. Finding fields include rule/version, severity/confidence, relative file and line/column, explanation, remediation, trade-offs, verification and SHA-256 fingerprint. Source text is not exported. Imports reject unknown schema versions, unsafe paths, oversized collections and malformed values.

Optional carbon fields contain user-supplied operational and transfer inputs, including provenance, period, boundary, workload and optional paired work count/unit. Outputs are deterministically recomputed; inputs remain in exports. Transfer inputs record CO2.js package and model versions. An unsupported historical package version is preserved but not recomputed using a different installed version. No supplied input is silently replaced with a guessed value.

## Local HTTP surface

`GET /api/projects`, `GET /api/scans`, `GET /api/scans/:id`, `GET /api/scans/:id/export`, `POST /api/import`, `POST /api/upload`, `PUT /api/scans/:id/carbon`, `DELETE /api/projects/:id`.

Uploads are multipart; imports use `{projectName, report}` JSON. Carbon PUT replaces the two optional input sets together; an empty object clears them. Deletion is disabled while project scans are queued or active. The UI confirms deletion. No endpoint accepts a server filesystem path from a browser.

The frontend request helper applies a 15-second timeout and action-specific errors without logging payloads. Overview/comparison polling is cancelled on navigation; successful refresh clears the related error. No automatic mutation retries are performed. New analysis uses keyboard-accessible tabs; schema and import provenance stay unchanged.

## Browser-first Express example

The existing `scripts/express-benchmark.ts` and `scripts/express-target.mjs` remain the only benchmark implementation. The browser action queues a fixed sample ID through `express-example.ts`; `jobs.ts` shares its single worker slot between ZIP scans and `express-worker.ts`. The latter verifies owned source, calls the shared scanner/benchmark, calculates the scenario and commits the artifact. Real stages and history live in SQLite `express_jobs`. Completed jobs are retained individually; optional `sourceScanId` links an exact recognised ZIP to its sample workload. API restart marks abandoned work failed. Ordinary scan schema 1.0 is unchanged.

`express-sample.ts` handles exact manifest verification and queue creation. ZIP workers verify extracted content after safe extraction, scan without executing it, then atomically link a recognised sample job. The Express worker never receives the extracted path. A local downloadable sample archive is regenerated by `npm run samples`, also run during `npm run dev` startup.

`packages/shared/src/benchmark.ts` continues to define `express-benchmark/1.0`, calculations, statistics and compatibility checks. Raw inputs, provenance, environment, versions, configuration, source/data hashes, source preview and every repetition are preserved. Dashboard numbers are derived from these stored records, not hard-coded. The legacy terminal command writes `.data/express-example.json`; this is a fallback when no browser jobs exist and is never overwritten by browser analysis.

GET `/api/examples/express` returns the latest job, result and history list; `?job=ID` reopens a saved run. GET `/api/examples/express/export?job=ID` downloads it. GET `/api/examples/express/source` returns verified source; GET `/api/examples/express/sample.zip` supplies the bundled archive. POST `/api/examples/express/analyse` accepts only the fixed sample identifier. `sample-launcher.tsx` provides the single start action; `express-example.tsx` polls progress and renders results; `resource-illustration.tsx` supplies local conceptual SVG/CSS with pause/reduced-motion support. Uploads, local CLI and report import reuse their original components; manual calculators are collapsed advanced diagnostics.

## EcoLens simplification (current entry point)

`apps/web/src/main.tsx` now renders only Home, Use EcoLens and How it works. The report stays within Use EcoLens. `legacy.tsx` preserves historical screens behind an advanced link, including old scenario semantics. Brand presentation changes do not migrate old report identifiers/data.

`eco-api.ts` handles bounded source/HAR uploads, sanitises HAR through `traffic.ts`, queues `eco_reports` and serves sanitised results/export/downloads. `jobs.ts` gives EcoLens jobs the same single worker slot used by existing workers. `eco-worker.ts` scans source or calls the adapted `runTrafficJourney` in the existing `scripts/express-benchmark.ts`. That uses the existing fixed target runner and cleanup helpers, now with two additional literal catalogue selectors, temporary SQLite and a local mock listener. It never receives an uploaded executable path. `traffic.ts` supplies one server-side CO2.js adapter for both evidence paths. No distributed infrastructure or new workspace package is introduced.

`packages/shared/src/traffic.ts` defines the sanitised evidence shape and pinned model provenance. New result schema is `ecolens/1.0`; old scanner and benchmark schemas remain intact. HAR request metadata is allowlisted, not a copied HAR object. Reports retain full precision and raw controlled repetitions; display rounds independently. Source-only reports have `traffic: null`. The example ZIP includes the 120-line JavaScript server, improved variant, fixtures, seed code, dependency declarations, local mock and setup instructions, provisioned by the existing samples script.
