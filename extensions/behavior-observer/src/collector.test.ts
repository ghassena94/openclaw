import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMessageReceivedRawEvent } from "./collector.js";
import { BehaviorObserverStore } from "./db.js";

describe("behavior-observer collector", () => {
  it("deduplicates repeated hook events with the same deterministic id", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "behavior-observer-collector-"));
    try {
      const store = new BehaviorObserverStore(stateDir);
      const event = createMessageReceivedRawEvent(
        {
          from: "alice",
          content: "status update",
          timestamp: 1_700_000_000_000,
        },
        {
          channelId: "slack",
          accountId: "acct-1",
          conversationId: "conv-1",
        },
      );

      expect(store.recordRawEvent(event)).toBe(true);
      expect(store.recordRawEvent(event)).toBe(false);
      expect(store.listUnnormalizedRawEvents()).toHaveLength(1);

      store.close();
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
