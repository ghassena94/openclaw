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
import type { JsonRecord } from "./types.js";
import { shortHash, stableValue, uniqueStrings } from "./util.js";

const SAFE_METADATA_KEYS = new Set([
  "threadId",
  "threadTs",
  "messageId",
  "parentConversationId",
  "conversationId",
  "channelId",
  "accountId",
  "senderId",
  "recipientId",
  "eventId",
  "jobId",
]);

function summarizeMetadata(metadata: Record<string, unknown> | undefined): JsonRecord {
  if (!metadata) {
    return {};
  }
  return Object.entries(metadata).reduce<JsonRecord>((acc, [key, value]) => {
    if (!SAFE_METADATA_KEYS.has(key)) {
      return acc;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function summarizeTopLevelKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value as Record<string, unknown>).sort();
}

function isEntityKeyName(key: string): boolean {
  return /(?:^|_)(?:id|thread|conversation|channel|sender|recipient|event|job|task|issue|ticket)$/.test(
    key.toLowerCase(),
  );
}

function summarizeEntityHints(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.entries(value as Record<string, unknown>).reduce<JsonRecord>((acc, [key, entry]) => {
    if (!isEntityKeyName(key)) {
      return acc;
    }
    if (typeof entry === "string" && entry.trim()) {
      acc[key] = shortHash(entry.trim());
    } else if (typeof entry === "number" && Number.isFinite(entry)) {
      acc[key] = String(entry);
    }
    return acc;
  }, {});
}

function summarizeText(text: string | undefined): JsonRecord {
  const value = text?.trim() ?? "";
  return {
    contentHash: value ? shortHash(value) : null,
    contentLength: value.length,
  };
}

function extractToolActionHint(toolName: string, params: Record<string, unknown>): string | null {
  const normalizedToolName = toolName.toLowerCase();
  if (normalizedToolName.includes(".add") || normalizedToolName.includes(".create")) {
    return "create";
  }
  if (normalizedToolName.includes(".update") || normalizedToolName.includes(".edit")) {
    return "update";
  }

  const action = params.action;
  if (typeof action === "string" && action.trim()) {
    return action.trim().toLowerCase();
  }
  return null;
}

export function minimizeMessageReceivedPayload(
  event: PluginHookMessageReceivedEvent,
  ctx: PluginHookMessageContext,
): JsonRecord {
  return stableValue({
    channelId: ctx.channelId,
    accountId: ctx.accountId ?? null,
    conversationId: ctx.conversationId ?? null,
    fromHash: shortHash(event.from.trim()),
    ...summarizeText(event.content),
    metadata: summarizeMetadata(event.metadata),
  }) as JsonRecord;
}

export function minimizeMessageSentPayload(
  event: PluginHookMessageSentEvent,
  ctx: PluginHookMessageContext,
): JsonRecord {
  return stableValue({
    channelId: ctx.channelId,
    accountId: ctx.accountId ?? null,
    conversationId: ctx.conversationId ?? null,
    toHash: shortHash(event.to.trim()),
    success: event.success,
    errorHash: event.error ? shortHash(event.error) : null,
    ...summarizeText(event.content),
  }) as JsonRecord;
}

export function minimizeToolPayload(
  event: PluginHookAfterToolCallEvent,
  ctx: PluginHookToolContext,
): JsonRecord {
  const params = event.params ?? {};
  const result =
    event.result && typeof event.result === "object" && !Array.isArray(event.result)
      ? (event.result as Record<string, unknown>)
      : undefined;
  const entityHints = uniqueStrings([
    ...Object.entries(summarizeEntityHints(params)).map(([key, value]) => `${key}:${String(value)}`),
    ...Object.entries(summarizeEntityHints(result)).map(([key, value]) => `${key}:${String(value)}`),
  ]);

  return stableValue({
    toolName: event.toolName,
    runId: event.runId ?? ctx.runId ?? null,
    toolCallId: event.toolCallId ?? ctx.toolCallId ?? null,
    ok: !event.error,
    errorHash: event.error ? shortHash(event.error) : null,
    durationMs: event.durationMs ?? null,
    actionHint: extractToolActionHint(event.toolName, params),
    paramsHash: shortHash(JSON.stringify(stableValue(params))),
    paramKeys: summarizeTopLevelKeys(params),
    resultHash: result ? shortHash(JSON.stringify(stableValue(result))) : null,
    resultKeys: summarizeTopLevelKeys(result),
    entityHints,
  }) as JsonRecord;
}

export function minimizeSessionStartPayload(
  event: PluginHookSessionStartEvent,
  ctx: PluginHookSessionContext,
): JsonRecord {
  return stableValue({
    sessionId: event.sessionId,
    resumedFrom: event.resumedFrom ?? null,
    sessionKey: event.sessionKey ?? ctx.sessionKey ?? null,
  }) as JsonRecord;
}

export function minimizeSessionEndPayload(
  event: PluginHookSessionEndEvent,
  ctx: PluginHookSessionContext,
): JsonRecord {
  return stableValue({
    sessionId: event.sessionId,
    sessionKey: event.sessionKey ?? ctx.sessionKey ?? null,
    messageCount: event.messageCount,
    durationMs: event.durationMs ?? null,
  }) as JsonRecord;
}
