import { scan } from "../packages/analysis-core/src/index.ts";
import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import yazl from "yazl";
await fs.mkdir("examples/generated", { recursive: true });
for (const variant of ["before", "after"]) {
  const root = `examples/${variant}`;
  const report = await scan(root, { synthetic: true });
  await fs.writeFile(
    `examples/generated/${variant}.json`,
    JSON.stringify(report, null, 2),
  );
  const zip = new yazl.ZipFile();
  for (const name of (await fs.readdir(root)).sort())
    zip.addFile(path.join(root, name), name);
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(`examples/generated/${variant}.zip`);
    out.on("close", resolve);
    out.on("error", reject);
    zip.outputStream.pipe(out);
    zip.end();
  });
}
console.log("Synthetic reports and ZIPs written to examples/generated.");

const manifest = JSON.parse(
  await fs.readFile("examples/express-reference/manifest.json", "utf8"),
);
const sampleZip = new yazl.ZipFile();
for (const name of Object.keys(manifest))
  sampleZip.addFile(path.join("examples/express-reference", name), name);
await new Promise<void>((resolve, reject) => {
  const out = createWriteStream("examples/generated/express-reference.zip");
  out.on("close", resolve);
  out.on("error", reject);
  sampleZip.outputStream.pipe(out);
  sampleZip.end();
});
const ecoManifest = JSON.parse(
  await fs.readFile("examples/ecolens-express/manifest.json", "utf8"),
);
const ecoZip = new yazl.ZipFile();
for (const name of Object.keys(ecoManifest))
  ecoZip.addFile(
    path.join("examples/ecolens-express", name),
    name === "SETUP.txt" ? "README.txt" : name,
  );
await new Promise<void>((resolve, reject) => {
  const out = createWriteStream("examples/generated/ecolens-express.zip");
  out.on("close", resolve);
  out.on("error", reject);
  ecoZip.outputStream.pipe(out);
  ecoZip.end();
});
