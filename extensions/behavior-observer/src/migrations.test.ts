import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BehaviorObserverStore } from "./db.js";
import { openSqliteDatabase } from "./sqlite.js";

describe("behavior-observer migrations", () => {
  it("creates the required schema and indexes", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "behavior-observer-schema-"));
    try {
      const store = new BehaviorObserverStore(stateDir);
      const dbPath = store.getDatabasePath();
      store.listPatterns();

      const db = openSqliteDatabase(dbPath);
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
        .all() as Array<{ name: string }>;
      const tableNames = tables.map((table) => table.name);
      expect(tableNames).toEqual(
        expect.arrayContaining([
          "approvals",
          "checkpoints",
          "episode_actions",
          "episodes",
          "executions",
          "normalized_actions",
          "patterns",
          "proposals",
          "raw_events",
        ]),
      );

      const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
      expect(version.user_version).toBe(1);

      db.close();
      store.close();
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
