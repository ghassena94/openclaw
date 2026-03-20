import { describe, expect, it } from "vitest";
import { normalizeRawEvent } from "./normalizers.js";
import type { RawEventRecord } from "./types.js";

function createRawEvent(overrides: Partial<RawEventRecord>): RawEventRecord {
  return {
    rawEventId: "raw-1",
    ts: 1_700_000_000_000,
    sessionKey: "session-1",
    conversationId: "conv-1",
    sourceKind: "tool",
    sourceName: "calendar.add",
    direction: null,
    payload: {
      ok: true,
      channelId: "slack",
      entityHints: ["eventId:e1"],
    },
    ...overrides,
  };
}

describe("behavior-observer normalizers", () => {
  it("normalizes inbound and outbound messages", () => {
    const inbound = normalizeRawEvent(
      createRawEvent({
        sourceKind: "message",
        sourceName: "message_received",
        direction: "in",
        payload: { channelId: "telegram", contentHash: "hash", contentLength: 10 },
      }),
    );
    const outbound = normalizeRawEvent(
      createRawEvent({
        sourceKind: "message",
        sourceName: "message_sent",
        direction: "out",
        payload: { channelId: "telegram", contentHash: "hash2", contentLength: 20, success: true },
      }),
    );

    expect(inbound[0]?.actionType).toBe("message.received");
    expect(outbound[0]?.actionType).toBe("message.sent");
  });

  it("maps calendar, task, automation, and fallback tool usage", () => {
    expect(normalizeRawEvent(createRawEvent({ sourceName: "calendar.add" }))[0]?.actionType).toBe(
      "calendar.event.created",
    );
    expect(
      normalizeRawEvent(createRawEvent({ sourceName: "calendar.update", payload: { ok: true } }))[0]
        ?.actionType,
    ).toBe("calendar.event.updated");
    expect(normalizeRawEvent(createRawEvent({ sourceName: "reminders.add" }))[0]?.actionType).toBe(
      "task.created",
    );
    expect(normalizeRawEvent(createRawEvent({ sourceName: "cron.add" }))[0]?.actionType).toBe(
      "automation.created",
    );
    expect(normalizeRawEvent(createRawEvent({ sourceName: "gateway.call" }))[0]?.actionType).toBe(
      "tool.gateway_call.used",
    );
  });
});
