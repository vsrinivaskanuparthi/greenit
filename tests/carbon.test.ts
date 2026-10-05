import { test } from "node:test";
import assert from "node:assert/strict";
import {
  operational,
  operationalSchema,
  transferSchema,
  carbonCompatibility,
  compare,
} from "../packages/shared/src/index.ts";
import { transfer } from "../packages/shared/src/carbon.ts";
import { scan } from "../packages/analysis-core/src/index.ts";
const context = {
  period: "one hour",
  boundary: "server electricity",
  workload: "fixed batch",
  provenance: "synthetic" as const,
  workCount: 1000,
  workUnit: "requests",
};
test("operational arithmetic, zero versus missing, and invalid inputs", () => {
  assert.deepEqual(operational({ ...context, kWh: 0.25, intensity: 400 }), {
    grams: 100,
    perUnit: 0.1,
  });
  assert.equal(operational({ ...context, kWh: 0, intensity: 0 }).grams, 0);
  for (const bad of [-1, NaN, Infinity, undefined, "0.25"])
    assert.equal(
      operationalSchema.safeParse({ ...context, kWh: bad, intensity: 400 })
        .success,
      false,
    );
  assert.equal(operationalSchema.safeParse({...context,kWh:1,intensity:1,workCount:1e-300}).success,false);
  assert.equal(
    operationalSchema.safeParse({
      ...context,
      kWh: 1,
      intensity: 1,
      workCount: 0,
    }).success,
    false,
  );
  assert.equal(
    operationalSchema.safeParse({
      ...context,
      kWh: 1,
      intensity: 1,
      workUnit: undefined,
    }).success,
    false,
  );
});
test("local pinned CO2.js SWD v4 accepts supplied bytes only", () => {
  const input = {
    ...context,
    bytes: 100000000,
    greenHosting: false,
    model: "swd-v4" as const,
    packageVersion: "0.18.0",
  };
  assert.ok(transfer(input).grams > 0);
  assert.equal(transfer({ ...input, bytes: 0 }).grams, 0);
  assert.equal(
    transferSchema.safeParse({ ...input, bytes: -1 }).success,
    false,
  );
  assert.equal(
    transferSchema.safeParse({ ...input, bytes: 1.1 }).success,
    false,
  );
  assert.throws(() => transfer({ ...input, packageVersion: "0.16.0" }));
});
test("comparison checks context, work unit and model compatibility", async () => {
  const a = { operational: { ...context, kWh: 0.25, intensity: 400 } };
  assert.equal(carbonCompatibility(a, a, "operational"), null);
  assert.match(
    carbonCompatibility(
      a,
      { operational: { ...a.operational, boundary: "different" } },
      "operational",
    )!,
    /boundary/,
  );
  assert.match(carbonCompatibility(a, undefined, "operational")!, /Both/);
  const x = await scan("examples/before"),
    y = await scan("examples/after");
  assert.equal(compare(x, y).resolved.length, 5);
  assert.equal(compare(x, x).unchanged.length, 5);
  assert.equal(compare(y, x).added.length, 5);
});
