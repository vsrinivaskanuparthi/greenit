// Sample application: load and parse once for this application process.
import express from 'express';
import fs from 'node:fs';
const app = express();
const referenceFile = new URL('../reference-data.json', import.meta.url);
const referenceData = JSON.parse(fs.readFileSync(referenceFile, 'utf8'));
// Refresh policy: restart the process after publishing a new reference-data.json.
// This endpoint never mutates referenceData. Each process holds its own copy.
app.disable('x-powered-by');
app.get('/reference-data', (_request, response) => {
  response.json(referenceData);
});
export default app;
