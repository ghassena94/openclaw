import type { ProposalRecord } from "./types.js";

export type CompiledBehaviorRule = {
  ruleId: string;
  sourceProposalId: string;
  trigger: Record<string, unknown>;
  steps: Array<Record<string, unknown>>;
  approvalRequired: true;
  status: "draft";
};

export function compileProposalToDraftRule(proposal: ProposalRecord): CompiledBehaviorRule {
  const automationSpec = proposal.automationSpec;
  const trigger =
    automationSpec && typeof automationSpec.trigger === "object" && automationSpec.trigger
      ? (automationSpec.trigger as Record<string, unknown>)
      : {};
  const steps = Array.isArray(automationSpec.steps)
    ? automationSpec.steps.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    : [];

  return {
    ruleId: `rule:${proposal.proposalId}`,
    sourceProposalId: proposal.proposalId,
    trigger,
    steps,
    approvalRequired: true,
    status: "draft",
  };
}
