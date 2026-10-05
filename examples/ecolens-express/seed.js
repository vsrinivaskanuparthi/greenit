import Database from 'better-sqlite3';
import fs from 'node:fs';
const fixture = JSON.parse(fs.readFileSync(new URL('./products.json', import.meta.url), 'utf8'));
export function seedDatabase(file) {
  const db = new Database(file);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,name TEXT,priceCents INTEGER,category TEXT,description TEXT,material TEXT,supplier TEXT,inspectionNote TEXT);
      CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY,status TEXT,currency TEXT);
      CREATE TABLE IF NOT EXISTS order_lines(orderId INTEGER,productId INTEGER,quantity INTEGER);`);
    db.transaction(() => {
      db.exec('DELETE FROM order_lines; DELETE FROM orders; DELETE FROM products;');
      const add = db.prepare('INSERT INTO products VALUES (@id,@name,@priceCents,@category,@description,@material,@supplier,@inspectionNote)');
      for (const item of fixture) add.run(item);
      db.prepare('INSERT INTO orders VALUES (?,?,?)').run(1,'ready','EUR');
      const line = db.prepare('INSERT INTO order_lines VALUES (?,?,?)');
      line.run(1,1,2); line.run(1,3,1);
    })();
  } finally { db.close(); }
}
