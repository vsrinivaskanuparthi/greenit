import { scan } from "../../analysis-core/src/index.ts";
import { promises as fs } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
if (args[0] === "scan") args.shift();
async function main() {
  const root = args.shift();
  if (!root || root.startsWith("-"))
    throw new Error(
      "Usage: npm run scan -- ./project --output ./report.json [--exclude pattern] [--synthetic]",
    );
  let output = "green-it-report.json";
  const exclude: string[] = [];
  let synthetic = false;
  while (args.length) {
    const flag = args.shift();
    if (flag === "--output" && args[0]) output = args.shift()!;
    else if (flag === "--exclude" && args[0]) exclude.push(args.shift()!);
    else if (flag === "--synthetic") synthetic = true;
    else throw new Error(`Unknown or incomplete option: ${flag}`);
  }
  const target = await fs.realpath(root);
  const dest = path.join(
    await fs.realpath(path.dirname(path.resolve(output))),
    path.basename(output),
  );
  if (dest === target || dest.startsWith(target + path.sep))
    throw new Error(
      "Output must be outside the scanned directory to preserve source files.",
    );
  const report = await scan(root, { exclude, synthetic });
  await fs.writeFile(dest, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(
    `${report.coverage.analysed.length} files analysed; ${report.findings.length} findings; coverage ${report.coverage.status}. Carbon estimate unavailable — measurement inputs required. Report: ${output}`,
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
