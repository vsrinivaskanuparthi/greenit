import { test } from "node:test";
import assert from "node:assert/strict";
import { api } from "../apps/web/src/api.ts";
test("request errors describe the action and recovery does not retain stale errors", async (t) => {
  const messages: unknown[] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => messages.push(args));
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(
    api("/projects", {}, "load projects"),
    /Unable to load projects.*server could not be reached/,
  );
  fetchMock.mock.mockImplementation(
    async () =>
      new Response(JSON.stringify([{ id: "example" }]), { status: 200 }),
  );
  assert.deepEqual(await api("/projects", {}, "load projects"), [
    { id: "example" },
  ]);
  fetchMock.mock.mockImplementation(
    async () =>
      new Response('{"error":"Invalid input or unsupported report schema."}', {
        status: 400,
      }),
  );
  await assert.rejects(
    api(
      "/import",
      { method: "POST", body: "synthetic-private-payload" },
      "upload the scan report",
    ),
    /Unable to upload the scan report.*Invalid input/,
  );
  assert.ok(!JSON.stringify(messages).includes("synthetic-private-payload"));
});
test("unreadable responses and ambiguous upload failures are actionable without exposing contents", async (t) => {
  t.mock.method(console, "warn", () => {});
  const mock = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>private content</html>", { status: 200 }),
  );
  await assert.rejects(api("/scans", {}, "load scans"), /unreadable response/);
  mock.mock.mockImplementation(async () => {
    throw new TypeError("private diagnostic");
  });
  await assert.rejects(
    api("/upload", { method: "POST" }, "upload source code"),
    /Check Overview before trying again/,
  );
});
