// SYNTHETIC source; never executed by the scanner.
import express from 'express';
import fs from 'node:fs';
const app = express();
app.get('/report', (_req, res) => {
  res.send(fs.readFileSync('report.json', 'utf8'));
});
export async function processItems(urls: string[]) {
  const config = '{"enabled":true}';
  for (const url of urls) {
    await fetch(url);
    const parsed = JSON.parse(config);
    console.log(parsed.enabled);
  }
}
