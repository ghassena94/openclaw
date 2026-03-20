import type { MinedPattern, ProposalRecord } from "./types.js";
import { sha256 } from "./util.js";

export type ProposalConflict = {
  hasActiveDuplicate: boolean;
  hasDeniedDuplicate: boolean;
  withinCooldown: boolean;
};

function humanizeAction(actionType: string): string {
  switch (actionType) {
    case "message.received":
      return "receive a message";
    case "message.sent":
      return "send a message";
    case "calendar.event.created":
      return "create a calendar event";
    case "calendar.event.updated":
      return "update a calendar event";
    case "task.created":
      return "create a task";
    case "automation.created":
      return "create an automation";
    case "session.started":
      return "start a session";
    case "session.ended":
      return "end a session";
    default:
      if (actionType.startsWith("tool.")) {
        return `use ${actionType.slice("tool.".length, -".used".length || undefined).replace(/_/g, ".")}`;
      }
      return actionType.replace(/\./g, " ");
  }
}

export function createProposalUserCopy(pattern: MinedPattern): string {
  const steps = pattern.sequence.map(humanizeAction).join(" -> ");
  return `I noticed you often ${steps}. Want me to keep that as an approval-gated automation suggestion?`;
}

export function createAutomationSpec(pattern: MinedPattern): Record<string, unknown> {
  return {
    version: 1,
    trigger: {
      actionType: pattern.sequence[0],
      observedFromPatternId: pattern.patternId,
    },
    steps: pattern.sequence.slice(1).map((actionType, index) => ({
      order: index + 1,
      actionType,
    })),
    approvalRequired: true,
    executionMode: "draft_only",
    executor: {
      kind: "placeholder",
      future: ["lobster", "webhook"],
    },
  };
}

export function createProposalEvidence(pattern: MinedPattern): Record<string, unknown> {
  return {
    support: pattern.support,
    confidence: pattern.confidence,
    recencyScore: pattern.recencyScore,
    lastSeenTs: pattern.lastSeenTs,
    exampleEpisodeIds: pattern.exampleEpisodeIds,
    recentEpisodeTimestamps: pattern.recentEpisodeTimestamps,
  };
}

export function shouldCreateProposal(conflict: ProposalConflict): boolean {
  if (conflict.hasActiveDuplicate) {
    return false;
  }
  if (conflict.hasDeniedDuplicate && conflict.withinCooldown) {
    return false;
  }
  if (conflict.withinCooldown) {
    return false;
  }
  return true;
}

export function buildProposalRecord(pattern: MinedPattern, now: number): ProposalRecord {
  const automationSpec = createAutomationSpec(pattern);
  const evidence = createProposalEvidence(pattern);
  return {
    proposalId: `prop_${sha256(`${pattern.patternId}:${now}`)}`,
    patternId: pattern.patternId,
    createdTs: now,
    status: "new",
    evidence,
    automationSpec,
    userCopy: createProposalUserCopy(pattern),
  };
}
