# EcoLens Airbus

**Understand your application’s digital carbon impact.** A small, single-user local prototype around CO2.js and selected source-efficiency checks. It is not an approved Airbus production system. Existing project data and legacy calculations are preserved.

## Start

Use Node.js 22 (tested with 22.10.0) and npm 10+:

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:3000**. The command builds the UI, provisions example downloads and starts the same-origin web/API/worker application. No separate frontend server, Docker or carbon configuration is required. Stop with Ctrl+C; restart after code changes. `PORT=3001 npm run dev` changes the loopback port. SQLite and historical data are in `.data/`; `GREEN_IT_DATA=/absolute/private/directory` selects another workspace. Do not run two instances against one directory. Native dependency installation may need build tools.

Runtime works offline after dependencies/browser binaries are provisioned. No remote assets, hosting checks, telemetry or public APIs are used. Keep the app on localhost; no authentication is provided. Use synthetic examples rather than confidential company material.

## Short demo

**Home → Use EcoLens → Try Express example → carbon estimate and code suggestions.**

1. Home explains Green IT and the two evidence paths.
2. Use EcoLens → Try Express example starts a real, fixed local journey. No byte, energy or carbon-factor fields appear.
3. Compare the recorded response bytes and **estimated CO₂e for the sample transfer scenario**, then inspect the field-selection improvement and file-read finding. The task checks every required record/field; fewer returned records are not treated as success.
4. Open How this was calculated or the optional three-step illustration. Download the sanitised JSON report; saved results reopen in the same workflow.

Alternatively upload **one .js/.ts/.jsx/.tsx file**, a **source ZIP**, a **HAR**, or source plus HAR, then click **Analyse**. Source-only reports say “Add a network recording to estimate transfer-related emissions.” Source size and finding counts never become carbon. Uploaded code is never executed or installed.

## HAR evidence and privacy

In browser developer tools, record a journey in Network, export a HAR (prefer sanitised export), and upload it. EcoLens independently sanitises it:

- Supports HAR 1.1/1.2 and uses only valid integer **`response.bodySize`**, the recorded encoded response-body bytes. It does not use decoded `content.size`/text, `_transferSize` including headers, session totals or request bytes.
- Missing/null/−1 sizes remain unknown; other negative, non-integer or implausibly large values are invalid. Explicit recorded zero remains zero. Explicit cache/service-worker hits and network failures are excluded; valid HTTP error-response bodies are included and labelled. Coverage/exclusion counts are visible.
- Stores numbered request labels, allowlisted HTTP methods, status, byte evidence and exclusion reason. **URLs (including paths/queries), headers, cookies, bodies, timing and IP details are discarded.** Raw HAR is never written to disk. Generic requests are deliberately not mapped to source lines.
- Limits: HAR 10 MiB / 5,000 entries; single source 1 MiB; ZIP 10 MiB compressed / 50 MiB expanded / 3,000 entries / 1 MiB per file. Existing traversal/symlink protections remain. Source temporary files are deleted after success/failure.

## Carbon method and parser

The server-side traffic adapter calls the existing pinned **`@tgwf/co2` 0.18.0** adapter with **`new co2({model: 'swd', version: 4}).perByte(bytes, false)`**, explicitly selecting Sustainable Web Design v4, bundled global defaults and no green-hosting assertion. No public lookup occurs. Full precision is saved; UI values use three significant figures and suitable units.

The [official CO2.js overview](https://developers.thegreenwebfoundation.org/co2js/overview/), [model documentation](https://developers.thegreenwebfoundation.org/co2js/models/overview/) and [perByte documentation](https://developers.thegreenwebfoundation.org/co2js/functions/perbyte/) were checked on 2026-10-02. SWD uses bytes as a proxy for data-centre, network and user-device use **plus embodied infrastructure**. It does not measure electricity or the complete production application's footprint. For localhost/intranet traffic, this is a web-model reference scenario, not calibrated evidence of Airbus network emissions. There is no added compute estimate. Unchanged bytes under identical assumptions produce unchanged CO2.js estimates, even if caching reduces CPU/file work.

The installed parser is **`@babel/parser` 7.29.9**, with **`@babel/traverse` 7.29.8**. Six existing narrow AST rules are retained: awaited fetch in loops, aggressive fixed polling, synchronous filesystem calls in direct Express handlers, invariant JSON parsing in loops, repeated fixed reference JSON in handlers, and React timers lacking identifiable cleanup. Related same-line file findings are grouped in the compact UI; full records remain exported. No broad response-size/database-frequency inference was added. Source analysis does not send an AST or source to CO2.js.

EcoLens is not a replacement for SonarQube, Checkmarx, or ESLint. Some findings may overlap. Its purpose is to bring selected efficiency findings and CO2.js traffic estimates into one simple workflow.

### Attribution

CO2.js is by Green Web Foundation, Apache-2.0; the SWD model is attributed to Sustainable Web Design. The documented global-intensity source is Ember (CC BY-SA 4.0). SWD v4 constants are bundled with the pinned library (global factor 494 gCO₂e/kWh); these are not a live regional grid factor. Regional Electricity Maps datasets and hosting APIs are not used. See [methodology](docs/METHODOLOGY.md) for the exact boundary and constants.

## Downloadable Express example

Use the **Download sample server.js** and **Example ZIP & setup** links. Sources are in `examples/ecolens-express/`; generated ZIP is `examples/generated/ecolens-express.zip`. The 120-line plain JavaScript server contains validated catalogue, detail, reference-data, order-summary, stock and quote routes, real SQLite queries, local file reads and a real HTTP call to the separate loopback mock service. Data is small and synthetic, with no delays or inflated padding.

The ZIP contains the before server, improved server, seed code/data, mock service, pinned dependency declarations and `README.txt`. From the extracted directory:

```sh
npm install
npm run mock       # terminal 1: local stock service on 4101
npm start          # terminal 2: before server on 4100
# Stop the before server, then:
npm run improved   # same application port
```

The automatic browser workflow needs none of these manual commands. It adapts the existing allowlisted target runner and shared worker scheduler. Three alternating repetitions per version each run a full warm-up, then the same seven-request journey at concurrency one: all 12 product identities/names/prices/categories across three pages, full product 1, reference data, order 1 lines/total, and availability 1. Every business result is checked against local fixtures. Actual client-facing uncompressed HTTP body bytes are collected; headers, requests, warm-up and the internal mock-service hop are outside scope. Failures prevent a completed comparison. Source/data hashes and raw repetitions are saved.

The improved list selects needed fields; product detail retains the full record. Clients needing omitted fields must use detail requests or retain the original contract, potentially eliminating the benefit. Both versions paginate. The improved reference cache refreshes on restart and must not be mutated. This file-work change alone does not change recorded bytes or CO2.js estimates.

## Advanced / legacy access

Use EcoLens → Saved results & advanced tools → Historical records, CLI and report import. Existing reports, scan comparisons, deletion and old compute scenarios retain their original meaning; the fixed-watts scenario is not part of the EcoLens journey. Existing report schema/tool identity are unchanged. New EcoLens results use a separate additive SQLite table.

The scanner remains available without running source or networking:

```sh
npm run scan -- ./examples/ecolens-express --output /tmp/ecolens-source-report.json --synthetic
```

Choose a non-existing output file outside the scanned folder. CLI reports omit excerpts and use relative paths. The previous `npm run benchmark:express` remains a **legacy compute-scenario diagnostic**, not the EcoLens transfer demo.

## Validation

```sh
npm run samples
npm run typecheck
npm test
npm run build
node --import tsx scripts/ecolens-browser-check.ts
```

Playwright Chromium is required for browser verification (`npx playwright install chromium` once while online). Tests use isolated temporary data and loopback sockets; run the real journey check without other heavy work. The EcoLens browser check uses port 3189 and leaves screenshots in ignored `playwright-results/`. Earlier UI-specific browser scripts describe the previous navigation; the current check is `ecolens-browser-check.ts`.

## Branding and continuity

The genuine white Airbus wordmark is stored locally, unchanged, at `apps/web/public/airbus-wordmark.svg`: [official source](https://www.airbus.com/themes/custom/airbus_web_experience_ui/logo.svg), referenced by the [Airbus homepage](https://www.airbus.com/en), inspected 2026-10-02. Original 200:36 proportions and colours are preserved. SHA-256 `f58650817e96b67d2d2de07812486d6522ace6270971b4393ba5c57362bcd43e`. System fonts and local assets only; no claim of internal design-system access or official approval.

Read [PROJECT_STATUS](docs/PROJECT_STATUS.md) for actual checks/limitations and exact next step. [Architecture](docs/ARCHITECTURE.md), [methodology](docs/METHODOLOGY.md), [security](docs/SECURITY.md) and [roadmap](docs/ROADMAP.md) retain continuity. Future sessions should read AGENTS.md and PROJECT_STATUS first.
