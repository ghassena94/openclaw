import type {
  PluginHookAfterToolCallEvent,
  PluginHookMessageReceivedEvent,
  PluginHookMessageSentEvent,
  PluginHookMessageContext,
  PluginHookSessionContext,
  PluginHookSessionEndEvent,
  PluginHookSessionStartEvent,
  PluginHookToolContext,
} from "openclaw/plugin-sdk/core";
import {
  minimizeMessageReceivedPayload,
  minimizeMessageSentPayload,
  minimizeSessionEndPayload,
  minimizeSessionStartPayload,
  minimizeToolPayload,
} from "./redaction.js";
import type { JsonRecord, RawEventDirection, RawEventRecord, RawEventSourceKind } from "./types.js";
import { sha256, stableStringify } from "./util.js";

type RawEventDraft = {
  ts: number;
  sessionKey: string | null;
  conversationId: string | null;
  sourceKind: RawEventSourceKind;
  sourceName: string;
  direction: RawEventDirection;
  payload: JsonRecord;
};

function finalizeRawEvent(draft: RawEventDraft): RawEventRecord {
  const canonical = stableStringify({
    ts: draft.ts,
    sessionKey: draft.sessionKey,
    conversationId: draft.conversationId,
    sourceKind: draft.sourceKind,
    sourceName: draft.sourceName,
    direction: draft.direction,
    payload: draft.payload,
  });

  return {
    rawEventId: `raw_${sha256(canonical)}`,
    ts: draft.ts,
    sessionKey: draft.sessionKey,
    conversationId: draft.conversationId,
    sourceKind: draft.sourceKind,
    sourceName: draft.sourceName,
    direction: draft.direction,
    payload: draft.payload,
  };
}

export function createMessageReceivedRawEvent(
  event: PluginHookMessageReceivedEvent,
  ctx: PluginHookMessageContext,
  observedTs: number = event.timestamp ?? Date.now(),
): RawEventRecord {
  return finalizeRawEvent({
    ts: observedTs,
    sessionKey: null,
    conversationId: ctx.conversationId ?? null,
    sourceKind: "message",
    sourceName: "message_received",
    direction: "in",
    payload: minimizeMessageReceivedPayload(event, ctx),
  });
}

export function createMessageSentRawEvent(
  event: PluginHookMessageSentEvent,
  ctx: PluginHookMessageContext,
  observedTs: number = Date.now(),
): RawEventRecord {
  return finalizeRawEvent({
    ts: observedTs,
    sessionKey: null,
    conversationId: ctx.conversationId ?? null,
    sourceKind: "message",
    sourceName: "message_sent",
    direction: "out",
    payload: minimizeMessageSentPayload(event, ctx),
  });
}

export function createAfterToolCallRawEvent(
  event: PluginHookAfterToolCallEvent,
  ctx: PluginHookToolContext,
  observedTs: number = Date.now(),
): RawEventRecord {
  return finalizeRawEvent({
    ts: observedTs,
    sessionKey: ctx.sessionKey ?? null,
    conversationId: null,
    sourceKind: "tool",
    sourceName: event.toolName,
    direction: null,
    payload: minimizeToolPayload(event, ctx),
  });
}

export function createSessionStartRawEvent(
  event: PluginHookSessionStartEvent,
  ctx: PluginHookSessionContext,
  observedTs: number = Date.now(),
): RawEventRecord {
  return finalizeRawEvent({
    ts: observedTs,
    sessionKey: event.sessionKey ?? ctx.sessionKey ?? null,
    conversationId: null,
    sourceKind: "session",
    sourceName: "session_start",
    direction: null,
    payload: minimizeSessionStartPayload(event, ctx),
  });
}

export function createSessionEndRawEvent(
  event: PluginHookSessionEndEvent,
  ctx: PluginHookSessionContext,
  observedTs: number = Date.now(),
): RawEventRecord {
  return finalizeRawEvent({
    ts: observedTs,
    sessionKey: event.sessionKey ?? ctx.sessionKey ?? null,
    conversationId: null,
    sourceKind: "session",
    sourceName: "session_end",
    direction: null,
    payload: minimizeSessionEndPayload(event, ctx),
  });
}
