import { describe, expect, it } from "vitest";
import { DEFAULT_BEHAVIOR_OBSERVER_CONFIG } from "./config.js";
import { buildEpisodes } from "./episodes.js";
import type { NormalizedActionRecord } from "./types.js";

function action(id: string, ts: number, entityKeys: string[] = []): NormalizedActionRecord {
  return {
    actionId: id,
    ts,
    sessionKey: "session-1",
    conversationId: "conv-1",
    actionType: "message.received",
    integration: "slack",
    entityKeys,
    features: {},
    rawEventId: `raw-${id}`,
  };
}

describe("behavior-observer episodes", () => {
  it("splits episodes when the configured gap is exceeded", () => {
    const result = buildEpisodes(
      [
        action("a1", 0, ["thread:t1"]),
        action("a2", 1_000, ["thread:t1"]),
        action("a3", 60 * 60_000, ["thread:t2"]),
      ],
      DEFAULT_BEHAVIOR_OBSERVER_CONFIG,
    );

    expect(result.episodes).toHaveLength(2);
    expect(result.episodeActions).toHaveLength(3);
  });

  it("keeps longer gaps together when entity keys overlap", () => {
    const result = buildEpisodes(
      [
        action("a1", 0, ["thread:t1"]),
        action("a2", 70 * 60_000, ["thread:t1"]),
      ],
      DEFAULT_BEHAVIOR_OBSERVER_CONFIG,
    );

    expect(result.episodes).toHaveLength(1);
  });
});
