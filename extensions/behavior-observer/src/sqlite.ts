import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);

export function openSqliteDatabase(dbPath: string): DatabaseSync {
  let DatabaseSyncCtor: typeof import("node:sqlite").DatabaseSync;
  try {
    ({ DatabaseSync: DatabaseSyncCtor } = require("node:sqlite") as typeof import("node:sqlite"));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `SQLite support is unavailable in this Node runtime (missing node:sqlite). ${message}`,
      { cause: err },
    );
  }

  const db = new DatabaseSyncCtor(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}
