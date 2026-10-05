import Database from "better-sqlite3";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
export function openStore(dataDir: string) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const db = new Database(path.join(dataDir, "green-it.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(
    `CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,createdAt TEXT NOT NULL);CREATE TABLE IF NOT EXISTS scans(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,status TEXT NOT NULL,origin TEXT NOT NULL,createdAt TEXT NOT NULL,error TEXT,report TEXT);`,
  );
  if (
    !(db.pragma("table_info(scans)") as { name: string }[]).some(
      (c) => c.name === "synthetic",
    )
  ) {
    db.exec(
      "ALTER TABLE scans ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0",
    );
  }
  db.exec(`CREATE TABLE IF NOT EXISTS express_jobs(
    id TEXT PRIMARY KEY,status TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,
    sourceScanId TEXT REFERENCES scans(id) ON DELETE CASCADE,error TEXT,result TEXT,history TEXT NOT NULL
  )`);
  db.exec(
    `CREATE TABLE IF NOT EXISTS eco_reports(id TEXT PRIMARY KEY,kind TEXT NOT NULL,status TEXT NOT NULL,createdAt TEXT NOT NULL,sourceName TEXT,traffic TEXT,result TEXT,error TEXT)`,
  );
  return db;
}
export type Store = ReturnType<typeof openStore>;
export type ScanRow = {
  id: string;
  projectId: string;
  status: string;
  origin: string;
  createdAt: string;
  error: string | null;
  report: string | null;
  synthetic: number;
};
