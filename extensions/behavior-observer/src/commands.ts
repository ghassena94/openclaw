import type { OpenClawPluginApi, OpenClawPluginCommandDefinition } from "openclaw/plugin-sdk/core";
import type { BehaviorObserverManager } from "./service.js";

function formatPercent(value: number | null): string {
  if (value == null) {
    return "n/a";
  }
  return `${Math.round(value * 100)}%`;
}

function formatPatternsCommand(manager: BehaviorObserverManager): string {
  const { proposals, patterns } = manager.listPatternsAndProposals();
  const proposalLines =
    proposals.length > 0
      ? proposals.map(
          (proposal) =>
            `- ${proposal.proposalId} [${proposal.status}] support=${proposal.support ?? "n/a"} confidence=${formatPercent(
              proposal.confidence,
            )}\n  ${proposal.userCopy}`,
        )
      : ["- No proposals yet."];

  const patternLines =
    patterns.length > 0
      ? patterns.map(
          (pattern) =>
            `- ${pattern.patternId} support=${pattern.support} confidence=${formatPercent(pattern.confidence)} recency=${pattern.recencyScore.toFixed(
              2,
            )}\n  ${pattern.sequence.join(" -> ")}`,
        )
      : ["- No strong patterns yet."];

  return [`Recent Proposals:`, ...proposalLines, ``, `Strong Patterns:`, ...patternLines].join("\n");
}

function formatExplainCommand(manager: BehaviorObserverManager, proposalId: string): string {
  const detail = manager.getProposalDetail(proposalId);
  if (!detail) {
    return "Proposal not found.";
  }

  const evidence = detail.proposal.evidence;
  const patternSequence = detail.pattern?.sequence.join(" -> ") ?? "unknown";
  const approval = detail.latestApproval
    ? `${detail.latestApproval.decision} @ ${new Date(detail.latestApproval.ts).toISOString()}`
    : "none";

  return [
    `Proposal: ${detail.proposal.proposalId}`,
    `Status: ${detail.proposal.status}`,
    `Pattern: ${patternSequence}`,
    `Support: ${String(evidence.support ?? detail.pattern?.support ?? "n/a")}`,
    `Confidence: ${formatPercent(
      typeof evidence.confidence === "number" ? evidence.confidence : detail.pattern?.confidence ?? null,
    )}`,
    `Recency: ${
      typeof evidence.recencyScore === "number"
        ? evidence.recencyScore.toFixed(2)
        : detail.pattern?.recencyScore.toFixed(2) ?? "n/a"
    }`,
    `Last Approval: ${approval}`,
    ``,
    `User Copy:`,
    detail.proposal.userCopy,
    ``,
    `Automation Spec:`,
    JSON.stringify(detail.proposal.automationSpec, null, 2),
    ``,
    `Evidence:`,
    JSON.stringify(detail.proposal.evidence, null, 2),
  ].join("\n");
}

function buildPatternsCommand(
  api: OpenClawPluginApi,
  manager: BehaviorObserverManager,
): OpenClawPluginCommandDefinition {
  return {
    name: "patterns",
    description: "List learned workflow proposals and strong behavior patterns.",
    acceptsArgs: false,
    handler: async () => {
      try {
        manager.runAnalysis("command:/patterns");
      } catch (err) {
        api.logger.warn(`behavior-observer /patterns refresh failed: ${String(err)}`);
      }
      return { text: formatPatternsCommand(manager) };
    },
  };
}

function buildPatternCommand(manager: BehaviorObserverManager): OpenClawPluginCommandDefinition {
  return {
    name: "pattern",
    description: "Approve, deny, install, or explain a learned behavior proposal.",
    acceptsArgs: true,
    handler: async (ctx) => {
      const tokens = (ctx.args ?? "").trim().split(/\s+/).filter(Boolean);
      const action = tokens[0]?.toLowerCase() ?? "";
      const proposalId = tokens[1]?.trim();

      if (!action || action === "help") {
        return {
          text: [
            "Usage:",
            "/pattern approve <proposalId> [once|always]",
            "/pattern deny <proposalId>",
            "/pattern install <proposalId>",
            "/pattern explain <proposalId>",
          ].join("\n"),
        };
      }

      if (!proposalId) {
        return { text: "Missing proposalId." };
      }

      if (action === "approve") {
        const mode = tokens[2]?.toLowerCase() === "once" ? "allow_once" : "always_allow";
        const result = manager.recordDecision({
          proposalId,
          decision: mode,
          scope: { channel: ctx.channel, senderId: ctx.senderId ?? null },
        });
        return {
          text: result.ok
            ? `Proposal ${proposalId} approved (${mode === "allow_once" ? "once" : "always"}).`
            : result.message,
        };
      }

      if (action === "deny") {
        const result = manager.recordDecision({
          proposalId,
          decision: "deny",
          scope: { channel: ctx.channel, senderId: ctx.senderId ?? null },
        });
        return {
          text: result.ok ? `Proposal ${proposalId} denied.` : result.message,
        };
      }

      if (action === "install") {
        const result = manager.installProposal(proposalId);
        return {
          text: result.ok
            ? `Proposal ${proposalId} marked installed as draft rule ${result.ruleId}. No external side effects were executed.`
            : result.message,
        };
      }

      if (action === "explain") {
        return { text: formatExplainCommand(manager, proposalId) };
      }

      return { text: `Unknown /pattern action: ${action}` };
    },
  };
}

export function registerBehaviorObserverCommands(
  api: OpenClawPluginApi,
  manager: BehaviorObserverManager,
): void {
  api.registerCommand(buildPatternsCommand(api, manager));
  api.registerCommand(buildPatternCommand(manager));
}
