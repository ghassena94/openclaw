import { describe, expect, it } from "vitest";
import { DEFAULT_BEHAVIOR_OBSERVER_CONFIG } from "./config.js";
import { minePatterns } from "./miner.js";
import type { MaterializedEpisode } from "./types.js";

function episode(id: string, actionTypes: string[], endTs: number): MaterializedEpisode {
  return {
    episodeId: id,
    startTs: endTs - 1_000,
    endTs,
    sessionKey: "session-1",
    conversationId: "conv-1",
    episodeKey: "session-1::conv-1",
    actionIds: actionTypes.map((_, index) => `${id}-${index}`),
    actionTypes,
    entityKeys: [],
  };
}

describe("behavior-observer miner", () => {
  it("mines repeated ordered sequences with deterministic confidence", () => {
    const patterns = minePatterns(
      [
        episode("e1", ["message.received", "calendar.event.created", "task.created"], 100),
        episode("e2", ["message.received", "calendar.event.created", "task.created"], 200),
        episode("e3", ["message.received", "calendar.event.created", "task.created"], 300),
      ],
      DEFAULT_BEHAVIOR_OBSERVER_CONFIG,
      400,
    );

    const strong = patterns.find(
      (pattern) =>
        pattern.sequence.join(" -> ") ===
        "message.received -> calendar.event.created -> task.created",
    );

    expect(strong).toBeTruthy();
    expect(strong?.support).toBe(3);
    expect(strong?.confidence).toBe(1);
    expect(strong?.recencyScore).toBeGreaterThan(0);
  });
});
