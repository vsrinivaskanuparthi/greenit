import yauzl from "yauzl";
import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
export const limits = {
  compressed: 10 * 1024 * 1024,
  expanded: 50 * 1024 * 1024,
  entries: 3000,
  file: 1024 * 1024,
};
export function safeEntry(name: string) {
  if (
    !name ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    /[\x00-\x1f]/.test(name) ||
    name.split("/").some((s) => s === ".." || s === "." || s === "")
  )
    throw new Error("Unsafe archive path");
  return name;
}
export async function extractZip(archive: string, destination: string) {
  if ((await fs.stat(archive)).size > limits.compressed)
    throw new Error("Compressed ZIP limit exceeded");
  await fs.mkdir(destination, { recursive: true, mode: 0o700 });
  await new Promise<void>((resolve, reject) => {
    yauzl.open(
      archive,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (err, zip) => {
        if (err || !zip) {
          reject(new Error("Invalid ZIP archive"));
          return;
        }
        let entries = 0,
          total = 0,
          done = false;
        const seen = new Set<string>();
        function fail(e: unknown) {
          if (done) return;
          done = true;
          zip!.close();
          reject(e);
        }
        zip.on("error", fail);
        zip.on("end", () => {
          if (!done) {
            done = true;
            resolve();
          }
        });
        zip.on("entry", (entry) => {
          void (async () => {
            if (++entries > limits.entries)
              throw new Error("ZIP entry count limit exceeded");
            const directory = entry.fileName.endsWith("/");
            const name = safeEntry(
              directory ? entry.fileName.slice(0, -1) : entry.fileName,
            );
            if (seen.has(name)) throw new Error("Duplicate ZIP path");
            seen.add(name);
            const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
            if (mode !== 0 && mode !== 0x8000 && mode !== 0x4000)
              throw new Error(
                "Symlinks and special archive entries are rejected",
              );
            if ((mode === 0x4000) !== directory && mode !== 0)
              throw new Error("Inconsistent archive entry type");
            if (entry.generalPurposeBitFlag & 1)
              throw new Error("Encrypted ZIP entries are unsupported");
            if (
              entry.uncompressedSize > limits.file ||
              total + entry.uncompressedSize > limits.expanded
            )
              throw new Error("Expanded ZIP size limit exceeded");
            const target = path.join(destination, name);
            if (directory) {
              await fs.mkdir(target, { recursive: true, mode: 0o700 });
              zip.readEntry();
              return;
            }
            await fs.mkdir(path.dirname(target), {
              recursive: true,
              mode: 0o700,
            });
            const stream = await new Promise<NodeJS.ReadableStream>(
              (res, rej) =>
                zip.openReadStream(entry, (e, s) =>
                  e || !s ? rej(e) : res(s),
                ),
            );
            let fileBytes = 0;
            await pipeline(
              stream,
              new Transform({
                transform(chunk, _enc, cb) {
                  fileBytes += chunk.length;
                  total += chunk.length;
                  if (fileBytes > limits.file || total > limits.expanded)
                    cb(new Error("ZIP extraction byte limit exceeded"));
                  else cb(null, chunk);
                },
              }),
              createWriteStream(target, { flags: "wx", mode: 0o600 }),
            );
            zip.readEntry();
          })().catch(fail);
        });
        zip.readEntry();
      },
    );
  });
}
