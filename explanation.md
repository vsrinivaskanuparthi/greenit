# Airbus Green IT Insights — plain-English explanation and product direction

## 1. What we want to build

One place where a developer uploads an application, receives an understandable analysis, sees an automatically generated carbon estimate when supported, and gets recommendations for improvement. The developer should not have to enter electricity consumption, transferred bytes, or carbon factors manually.

The intended experience is: upload → analyse → explain resource usage → estimate emissions → suggest improvements → compare a revised version.

This is the product goal, not a claim that the present MVP already implements everything.

## 2. What software carbon means

Source code does not directly release carbon. Running it uses processors, memory, storage, networks, and end-user devices. Electricity supply and hardware manufacturing have associated greenhouse-gas emissions, expressed as carbon dioxide equivalent (CO2e).

Unnecessary work can increase resource consumption. Across heavily used applications, reducing that work can help resource efficiency, operating costs, and sustainability. No Airbus-specific savings have been established for this project.

Total emissions and efficiency are different: a busy application can have higher total emissions while using fewer resources per completed request. Compare equivalent work, such as 1,000 successful requests.

## 3. What scanning means

Scanning means reading source files and checking specific code patterns. It does not mean executing the application or measuring electricity.

Our scanner is custom software developed for this project, using a code parser. The parser turns code into a structured representation called an Abstract Syntax Tree (AST). Our rules inspect that structure, much as a spellchecker applies rules to text.

Based on the supplied implementation report, the initial scanner has five narrow checks involving awaited fetch calls in loops, short recurring timers, synchronous filesystem calls in recognised Express handlers, repeated parsing of unchanged JSON in loops, and React interval cleanup. Exact coverage must be checked against the repository. It is not a complete review of every possible inefficiency.

A finding means “review this pattern,” not “this line emits a known amount of carbon.”

## 4. A simple JavaScript and Express example

```js
app.get('/products', (req, res) => {
  const text = fs.readFileSync('./products.json', 'utf8');
  res.json(JSON.parse(text));
});
```

Each request reads and parses the file again. A scanner rule can identify the synchronous read in the request handler. A developer could review asynchronous access or caching. If the data rarely changes, loading it once and reusing it may help, with an explicit refresh policy. Caching has memory and freshness trade-offs.

The rule alone cannot tell us how often the endpoint runs, how expensive the work is, or how much energy a change saves.

## 5. How code reaches the scanner

### Upload a ZIP

The web application extracts supported files safely, runs the scanner, stores findings, and displays the report. It excludes dependencies and generated outputs and does not execute uploaded code in the initial MVP.

### Scan locally and upload results

The project includes a custom npm script named `scan`. It is not a built-in npm carbon scanner.

```bash
npm run scan -- ./examples/before --output /tmp/green-it-report.json --synthetic
```

- `npm run scan`: runs this project's scan script from package.json.
- `--`: passes subsequent arguments to that script.
- `./examples/before`: input folder containing the sample application.
- `--output ...`: location for the output JSON report.
- `--synthetic`: labels the supplied example as sample data.

Run the command from the Green IT repository using the implementation's documented setup. For a real project, replace the input path and omit the sample flag. The report holds findings, file paths, coverage, and versions; it is not automatically an energy measurement. Default reports omit source excerpts according to the supplied implementation report.

The web dashboard can import this report without receiving the complete source repository. This advanced workflow is useful for large applications; ZIP upload should remain the simple primary experience.

## 6. What happens after scanning

The dashboard shows checked files, exclusions, unsupported areas, findings, locations, explanations, and suggestions. A developer reviews and applies a suitable change, then scans again. A comparison shows added, resolved, and unchanged findings.

Fewer findings do not by themselves prove lower energy consumption or carbon emissions.

## 7. Where CO2.js fits

CO2.js is an existing open-source estimation library. It is separate from our custom scanner. It accepts data-transfer inputs, such as bytes, and uses a model to estimate associated emissions. The precise boundary depends on the selected model.

It does not read arbitrary Express source code and calculate the entire application's footprint. Repository or ZIP size is not application traffic.

In an automated flow, our tooling should collect applicable transferred-byte measurements and pass them to CO2.js behind the scenes. The user need not type those values.

If caching reduces server computation but the response bytes stay identical, a bytes-based estimate may not change. Server compute needs its own energy assessment. Do not sum overlapping compute and CO2.js estimates.

## 8. How operational carbon is calculated

Operational emissions (gCO2e) = energy (kWh) × electricity carbon intensity (gCO2e/kWh).

Energy can be measured with suitable instrumentation or estimated using a defensible model. CPU time, memory use, and duration are useful observations but are not direct energy measurements. Processor TDP is not the application's measured power.

An operational-only estimate excludes hardware manufacturing unless explicitly modelled separately. It is not automatically a complete lifecycle footprint.

## 9. The clarified requirement: no manual carbon forms

The desired product should collect what it can automatically and use centrally maintained, documented model parameters where appropriate. Assumptions belong in expandable calculation details, not in a mandatory form for the developer.

Removing manual entry changes how inputs are obtained; it does not remove the need for evidence.

There are three distinct evidence levels:

| Level | What the tool has | Honest output |
|---|---|---|
| Source-only analysis | Code patterns and project structure | Findings and qualitative potential impact; no reliable application-wide carbon amount |
| Supported modelled scenario | Defined workload and infrastructure assumptions plus a model supported for that application type | Scenario-based estimate, visibly labelled with its assumptions |
| Controlled execution | Repeatable workload, collected resource metrics, and energy measurements or a documented energy model | Workload-specific operational carbon estimate, with measured/modelled provenance |

A generic default carbon figure unrelated to the uploaded application's behaviour would not answer the user's question. Do not manufacture an estimate from finding counts or source size. If a defensible application-specific estimate cannot be produced, show the limitation clearly.

## 10. Recommended next MVP capability

Build an automated flow for one known JavaScript Express sample first. Provide a button such as “Analyse Express example.” Behind that action, the application can:

1. Scan the sample code.
2. Execute only an allowlisted sample in a controlled environment.
3. Send a standard workload and validate successful responses.
4. Collect CPU time, duration, memory statistics, and relevant response bytes.
5. Apply a documented energy method and a configured carbon factor.
6. Display an estimate per 1,000 successful requests.
7. Repeat for the improved sample and compare compatible results.

Repeat runs and show variability. Never guarantee that the improved version produces a lower result. If the available model is illustrative, label the result “Scenario estimate,” not measured emissions.

This is a focused proof of the one-stop experience. Automatically running any uploaded enterprise application is a separate engineering problem: applications may need databases, credentials, build dependencies, and representative workloads. General support requires isolated execution, resource limits, restricted networking, and supported project adapters. Do not silently enable execution of arbitrary ZIP uploads.

## 11. Visual explanation and animation

Use a short, explanatory animation showing:

Request arrives → Express handler performs work → CPU/storage/network use resources → energy demand → estimated CO2e.

For the reference-data example, illustrate repeated file reads before optimisation and reuse of loaded data afterward. Connect the illustration to the real finding's file and line where available.

Use a clear “Illustration” label. Animation speed, particles, and colours must not imply measured emissions or quantified savings. A request does not literally release smoke from a line of code. Keep actual numeric results in separate evidence-backed cards.

The animation may explain a detected code path, but it is not an execution trace unless tracing was actually performed. Include reduced-motion support and a readable static equivalent.

## 12. Dashboard priorities

1. Carbon estimate per defined workload, with a clear scenario/estimated label and scope.
2. Explanation of how running the application leads to energy use.
3. Code findings and actionable changes.
4. Before/after results under equivalent conditions.
5. Expandable calculation details and coverage.

Keep CLI/report import under advanced options. Keep manual calculators out of the primary journey; existing ones can remain advanced diagnostics if useful.

## 13. Current versus intended state

The user's supplied Codex report says the MVP includes the scanner, CLI, ZIP worker, imported reports, persistence, comparison, and manual carbon calculators. This document does not independently verify the repository.

Branding refinements and an automated Express benchmark were requested later. Their completion has not been confirmed here.

The automatic carbon-first workflow and animation described above are the clarified target, not a statement that they are already shipped.

## 14. Simple presentation message

“Airbus Green IT Insights helps developers see where an application may waste resources, understand how running software creates an associated carbon footprint, and compare estimated emissions for a defined workload before and after an improvement.”

## Reference documentation

- CO2.js overview: https://developers.thegreenwebfoundation.org/co2js/overview/
- Software Carbon Intensity methodology: https://sci.greensoftware.foundation/

These explain estimation concepts; using a library or formula alone does not establish compliance or measurement accuracy.
