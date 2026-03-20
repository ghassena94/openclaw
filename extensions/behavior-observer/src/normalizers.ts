import type { JsonRecord, NormalizationAdapter, NormalizedActionRecord, RawEventRecord } from "./types.js";
import { sha256, slugifySegment, uniqueStrings } from "./util.js";

function extractEntityKeys(payload: JsonRecord, conversationId: string | null): string[] {
  const entityHints = Array.isArray(payload.entityHints)
    ? payload.entityHints.filter((value): value is string => typeof value === "string")
    : [];
  const metadata = payload.metadata;
  const metadataEntries =
    metadata && typeof metadata === "object"
      ? Object.entries(metadata as Record<string, unknown>)
          .filter(([, value]) => typeof value === "string" || typeof value === "number")
          .map(([key, value]) => `${key}:${String(value)}`)
      : [];
  return uniqueStrings([
    ...entityHints,
    ...metadataEntries,
    ...(conversationId ? [`conversation:${conversationId}`] : []),
  ]);
}

function createAction(
  rawEvent: RawEventRecord,
  params: {
    actionType: string;
    integration?: string | null;
    entityKeys?: string[];
    features?: JsonRecord;
    discriminator?: string;
  },
): NormalizedActionRecord {
  const canonical = JSON.stringify({
    rawEventId: rawEvent.rawEventId,
    actionType: params.actionType,
    integration: params.integration ?? null,
    entityKeys: params.entityKeys ?? [],
    discriminator: params.discriminator ?? params.actionType,
  });
  return {
    actionId: `act_${sha256(canonical)}`,
    ts: rawEvent.ts,
    sessionKey: rawEvent.sessionKey,
    conversationId: rawEvent.conversationId,
    actionType: params.actionType,
    integration: params.integration ?? null,
    entityKeys: uniqueStrings(params.entityKeys ?? []),
    features: params.features ?? {},
    rawEventId: rawEvent.rawEventId,
  };
}

function toolOk(payload: JsonRecord): boolean {
  return payload.ok !== false;
}

function actionHint(payload: JsonRecord): string | null {
  return typeof payload.actionHint === "string" ? payload.actionHint : null;
}

function toolPrefix(toolName: string): string {
  const [prefix] = toolName.split(".", 1);
  return prefix || toolName;
}

function matchesTool(rawEvent: RawEventRecord, predicate: (toolName: string) => boolean): boolean {
  return rawEvent.sourceKind === "tool" && predicate(rawEvent.sourceName.toLowerCase());
}

const sessionAdapter: NormalizationAdapter = {
  name: "session",
  matches: (rawEvent) => rawEvent.sourceKind === "session",
  toActions: (rawEvent) => {
    const actionType = rawEvent.sourceName === "session_start" ? "session.started" : "session.ended";
    return [
      createAction(rawEvent, {
        actionType,
        integration: "session",
        entityKeys: rawEvent.sessionKey ? [`session:${rawEvent.sessionKey}`] : [],
      }),
    ];
  },
};

const inboundMessageAdapter: NormalizationAdapter = {
  name: "message-received",
  matches: (rawEvent) => rawEvent.sourceKind === "message" && rawEvent.direction === "in",
  toActions: (rawEvent) => {
    const entityKeys = extractEntityKeys(rawEvent.payload, rawEvent.conversationId);
    return [
      createAction(rawEvent, {
        actionType: "message.received",
        integration: String(rawEvent.payload.channelId ?? "message"),
        entityKeys,
        features: {
          contentHash: rawEvent.payload.contentHash ?? null,
          contentLength: rawEvent.payload.contentLength ?? null,
        },
      }),
    ];
  },
};

const outboundMessageAdapter: NormalizationAdapter = {
  name: "message-sent",
  matches: (rawEvent) => rawEvent.sourceKind === "message" && rawEvent.direction === "out",
  toActions: (rawEvent) => {
    const entityKeys = extractEntityKeys(rawEvent.payload, rawEvent.conversationId);
    return [
      createAction(rawEvent, {
        actionType: "message.sent",
        integration: String(rawEvent.payload.channelId ?? "message"),
        entityKeys,
        features: {
          contentHash: rawEvent.payload.contentHash ?? null,
          contentLength: rawEvent.payload.contentLength ?? null,
          success: rawEvent.payload.success ?? true,
        },
      }),
    ];
  },
};

const calendarToolAdapter: NormalizationAdapter = {
  name: "calendar-tool",
  matches: (rawEvent) =>
    matchesTool(rawEvent, (toolName) => toolName.startsWith("calendar.") || toolName.includes("calendar")),
  toActions: (rawEvent) => {
    if (!toolOk(rawEvent.payload)) {
      return [];
    }

    const hint = actionHint(rawEvent.payload);
    let actionType: string | null = null;
    if (
      rawEvent.sourceName.toLowerCase().includes(".add") ||
      rawEvent.sourceName.toLowerCase().includes(".create") ||
      hint === "create" ||
      hint === "add"
    ) {
      actionType = "calendar.event.created";
    } else if (
      rawEvent.sourceName.toLowerCase().includes(".update") ||
      rawEvent.sourceName.toLowerCase().includes(".edit") ||
      hint === "update" ||
      hint === "edit"
    ) {
      actionType = "calendar.event.updated";
    }

    if (!actionType) {
      return [];
    }

    return [
      createAction(rawEvent, {
        actionType,
        integration: "calendar",
        entityKeys: extractEntityKeys(rawEvent.payload, rawEvent.conversationId),
        features: {
          toolName: rawEvent.sourceName,
          durationMs: rawEvent.payload.durationMs ?? null,
        },
      }),
    ];
  },
};

const taskToolAdapter: NormalizationAdapter = {
  name: "task-tool",
  matches: (rawEvent) =>
    matchesTool(rawEvent, (toolName) =>
      /(?:task|todo|issue|ticket|reminder)s?\.(?:add|create|new)|(?:task|todo|issue|ticket|reminder)s?$/.test(
        toolName,
      ),
    ) ||
    matchesTool(rawEvent, (toolName) => toolName === "reminders.add"),
  toActions: (rawEvent) => {
    if (!toolOk(rawEvent.payload)) {
      return [];
    }
    return [
      createAction(rawEvent, {
        actionType: "task.created",
        integration: toolPrefix(rawEvent.sourceName),
        entityKeys: extractEntityKeys(rawEvent.payload, rawEvent.conversationId),
        features: {
          toolName: rawEvent.sourceName,
          durationMs: rawEvent.payload.durationMs ?? null,
        },
      }),
    ];
  },
};

const automationToolAdapter: NormalizationAdapter = {
  name: "automation-tool",
  matches: (rawEvent) =>
    matchesTool(rawEvent, (toolName) =>
      /^(cron|automation|workflow|schedule|scheduler)\.(add|create|new)/.test(toolName),
    ),
  toActions: (rawEvent) => {
    if (!toolOk(rawEvent.payload)) {
      return [];
    }
    return [
      createAction(rawEvent, {
        actionType: "automation.created",
        integration: toolPrefix(rawEvent.sourceName),
        entityKeys: extractEntityKeys(rawEvent.payload, rawEvent.conversationId),
        features: {
          toolName: rawEvent.sourceName,
          durationMs: rawEvent.payload.durationMs ?? null,
        },
      }),
    ];
  },
};

const genericToolAdapter: NormalizationAdapter = {
  name: "generic-tool",
  matches: (rawEvent) => rawEvent.sourceKind === "tool",
  toActions: (rawEvent) => [
    createAction(rawEvent, {
      actionType: `tool.${slugifySegment(rawEvent.sourceName)}.used`,
      integration: toolPrefix(rawEvent.sourceName),
      entityKeys: extractEntityKeys(rawEvent.payload, rawEvent.conversationId),
      features: {
        ok: rawEvent.payload.ok ?? true,
        durationMs: rawEvent.payload.durationMs ?? null,
        toolName: rawEvent.sourceName,
      },
    }),
  ],
};

export const DEFAULT_NORMALIZATION_ADAPTERS: NormalizationAdapter[] = [
  sessionAdapter,
  inboundMessageAdapter,
  outboundMessageAdapter,
  calendarToolAdapter,
  taskToolAdapter,
  automationToolAdapter,
  genericToolAdapter,
];

export function normalizeRawEvent(
  rawEvent: RawEventRecord,
  adapters: NormalizationAdapter[] = DEFAULT_NORMALIZATION_ADAPTERS,
): NormalizedActionRecord[] {
  for (const adapter of adapters) {
    if (!adapter.matches(rawEvent)) {
      continue;
    }
    const actions = adapter.toActions(rawEvent);
    if (actions.length > 0) {
      return actions;
    }
  }
  return [];
}
