// Sample application: read and parse reference data for every request.
import express from 'express';
import fs from 'node:fs';
const app = express();
const referenceFile = new URL('../reference-data.json', import.meta.url);
app.disable('x-powered-by');
app.get('/reference-data', (_request, response) => {
  const referenceData = JSON.parse(fs.readFileSync(referenceFile, 'utf8'));
  response.json(referenceData);
});
export default app;
