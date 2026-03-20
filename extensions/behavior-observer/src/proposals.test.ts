import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BehaviorObserverStore } from "./db.js";
import { buildProposalRecord, shouldCreateProposal } from "./proposals.js";
import type { MinedPattern } from "./types.js";

function pattern(): MinedPattern {
  return {
    patternId: "pat-1",
    sequence: ["message.received", "calendar.event.created", "task.created"],
    support: 3,
    confidence: 0.75,
    recencyScore: 0.9,
    windowSec: 120,
    lastSeenTs: 1_700_000_000_000,
    exampleEpisodeIds: ["ep-1"],
    recentEpisodeTimestamps: [1_700_000_000_000],
  };
}

describe("behavior-observer proposals", () => {
  it("dedupes active proposals and respects cooldown", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "behavior-observer-proposals-"));
    try {
      const store = new BehaviorObserverStore(stateDir);
      const now = 1_700_000_000_000;
      store.replacePatterns([
        {
          patternId: "pat-1",
          sequence: ["message.received", "calendar.event.created", "task.created"],
          support: 3,
          confidence: 0.75,
          recencyScore: 0.9,
          windowSec: 120,
          lastSeenTs: now,
        },
      ]);
      const proposal = buildProposalRecord(pattern(), now);
      expect(store.insertProposal(proposal)).toBe(true);

      const activeConflict = store.findProposalConflict("pat-1", now + 1_000, 10_000);
      expect(shouldCreateProposal(activeConflict)).toBe(false);

      store.updateProposalStatus(proposal.proposalId, "denied");
      const deniedConflict = store.findProposalConflict("pat-1", now + 2_000, 10_000);
      expect(deniedConflict.hasDeniedDuplicate).toBe(true);
      expect(shouldCreateProposal(deniedConflict)).toBe(false);

      const expiredConflict = store.findProposalConflict("pat-1", now + 20_000, 10_000);
      expect(expiredConflict.withinCooldown).toBe(false);
      expect(shouldCreateProposal(expiredConflict)).toBe(true);

      store.close();
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
