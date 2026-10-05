import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, apiErrors } from "./app.ts";
import { openStore } from "./store.ts";
import { startJobs } from "./jobs.ts";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const dataDir = path.resolve(
  process.env.GREEN_IT_DATA ?? path.join(root, ".data"),
);
const tempDir = path.join(dataDir, "temporary");
const db = openStore(dataDir);
const app = express();
let ready = false;
app.use((_req, res, next) =>
  ready
    ? next()
    : res
        .status(503)
        .json({ error: "Local workspace is starting; retry shortly." }),
);
app.use(createApp(db, tempDir));
const web = path.join(root, "apps/web/dist");
app.use(express.static(web));
app.get("/{*path}", (req, res) => {
  if (req.path.startsWith("/api/"))
    res.status(404).json({ error: "Not found" });
  else res.sendFile(path.join(web, "index.html"));
});
app.use(apiErrors);
const port = Number(process.env.PORT ?? 3000);
const server = createServer(app);
let jobs: Awaited<ReturnType<typeof startJobs>> | undefined;
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error("[Startup]", { code: error.code, host: "127.0.0.1", port });
  console.error(
    "Unable to bind local port. Another instance may already be running.",
  );
  db.close();
  process.exit(1);
});
// Recover jobs only after binding succeeds; a duplicate launch must not interrupt a running instance.
server.listen(port, "127.0.0.1", () => {
  void (async () => {
    jobs = await startJobs(db, dataDir, tempDir);
    ready = true;
    console.log(`EcoLens Airbus: http://127.0.0.1:${port}`);
  })().catch((error: unknown) => {
    console.error("[Startup]", {
      stage: "workspace",
      kind: error instanceof Error ? error.name : "UnknownError",
    });
    console.error("Unable to initialise local workspace.");
    process.exit(1);
  });
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  ready = false;
  server.close();
  await jobs?.stop();
  db.close();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
