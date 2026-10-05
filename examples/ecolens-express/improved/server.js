// Sample application: fictional parts catalogue, reference data and order review.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { seedDatabase } from '../seed.js';
const directory = path.dirname(fileURLToPath(import.meta.url));
const referenceFile = new URL('../reference.json', import.meta.url);
export function createApplication({ databaseFile, mockOrigin }) {
  const remote = new URL(mockOrigin);
  if (remote.hostname !== '127.0.0.1' || remote.protocol !== 'http:') {
    throw new Error('The sample only permits its local mock service.');
  }
  seedDatabase(databaseFile);
  const database = new Database(databaseFile, { readonly: true });
  const products = database.prepare('SELECT * FROM products ORDER BY id');
  const productById = database.prepare('SELECT * FROM products WHERE id = ?');
  const orderById = database.prepare('SELECT * FROM orders WHERE id = ?');
  const linesByOrder = database.prepare('SELECT * FROM order_lines WHERE orderId = ? ORDER BY productId');
  const categories = database.prepare('SELECT DISTINCT category FROM products ORDER BY category');
  // Refresh policy: restart after updating reference.json; never mutate the cached object.
  const reference = JSON.parse(fs.readFileSync(referenceFile, 'utf8'));
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));
  function positiveInteger(value, fallback) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }
  function sendError(response, status, message) {
    return response.status(status).json({ error: message });
  }
  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', application: 'Sample application' });
  });
  app.get('/reference-data', (_request, response) => {
    response.json(reference);
  });
  app.get('/categories', (_request, response) => {
    response.json({ categories: categories.all().map(row => row.category) });
  });
  app.get('/products', (request, response) => {
    const limit = positiveInteger(request.query.limit, 50);
    const page = positiveInteger(request.query.page, 1);
    if (limit === null || limit > 50 || page === null || page > 1000) {
      return sendError(response, 400, 'Use page 1–1000 and limit 1–50.');
    }
    const rows = products.all();
    const offset = (page - 1) * limit;
    // A list projection preserves every requested record and required business field.
    // Full descriptions and inspection fields remain on /products/:id.
    const items = rows.slice(offset, offset + limit).map(({ id, name, priceCents, category }) => ({
      id, name, priceCents, category
    }));
    response.json({ items, total: rows.length, page, limit });
  });
  app.get('/products/:id', (request, response) => {
    const id = positiveInteger(request.params.id);
    if (id === null) return sendError(response, 400, 'Invalid product identifier.');
    const product = productById.get(id);
    if (!product) return sendError(response, 404, 'Product not found.');
    response.json(product);
  });
  app.get('/orders/:id/summary', (request, response) => {
    const id = positiveInteger(request.params.id);
    if (id === null) return sendError(response, 400, 'Invalid order identifier.');
    const order = orderById.get(id);
    if (!order) return sendError(response, 404, 'Order not found.');
    const lines = linesByOrder.all(id).map(line => {
      const product = productById.get(line.productId);
      if (!product) throw new Error('Seeded order references a missing product.');
      return { productId: product.id, name: product.name, quantity: line.quantity,
        unitPriceCents: product.priceCents, lineTotalCents: line.quantity * product.priceCents };
    });
    const totalCents = lines.reduce((total, line) => total + line.lineTotalCents, 0);
    response.json({ id, status: order.status, currency: order.currency, lines, totalCents });
  });
  app.get('/availability/:id', async (request, response, next) => {
    const id = positiveInteger(request.params.id);
    if (id === null) return sendError(response, 400, 'Invalid product identifier.');
    if (!productById.get(id)) return sendError(response, 404, 'Product not found.');
    try {
      const upstream = await fetch(`${remote.origin}/stock/${id}`, {
        signal: AbortSignal.timeout(2000), redirect: 'error'
      });
      if (!upstream.ok) return sendError(response, 502, 'Local stock service unavailable.');
      const stock = await upstream.json();
      if (stock.productId !== id || !Number.isInteger(stock.available) || stock.available < 0) {
        return sendError(response, 502, 'Local stock service returned invalid data.');
      }
      response.json({ productId: id, available: stock.available, warehouse: stock.warehouse });
    } catch (error) {
      next(error);
    }
  });
  app.post('/quote', (request, response) => {
    const { productId, quantity } = request.body ?? {};
    if (!Number.isSafeInteger(productId) || productId < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) {
      return sendError(response, 400, 'Provide a positive productId and quantity 1–100.');
    }
    const product = productById.get(productId);
    if (!product) return sendError(response, 404, 'Product not found.');
    response.json({ productId, quantity, totalCents: product.priceCents * quantity, currency: 'EUR' });
  });
  app.use((_request, response) => {
    sendError(response, 404, 'Endpoint not found.');
  });
  app.use((_error, _request, response, _next) => {
    sendError(response, 503, 'Sample service temporarily unavailable.');
  });
  return { app, close: () => database.close() };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const instance = createApplication({ databaseFile: path.join(directory, 'sample.sqlite'), mockOrigin: 'http://127.0.0.1:4101' });
  const server = instance.app.listen(4100, '127.0.0.1', () => {
    console.log('Sample application: http://127.0.0.1:4100');
  });
  const stop = () => server.close(() => { instance.close(); process.exit(0); });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
