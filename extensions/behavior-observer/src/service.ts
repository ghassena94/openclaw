import type {
  PluginHookAfterToolCallEvent,
  PluginHookMessageContext,
  PluginHookMessageReceivedEvent,
  PluginHookMessageSentEvent,
  PluginHookSessionContext,
  PluginHookSessionEndEvent,
  PluginHookSessionStartEvent,
  PluginHookToolContext,
} from "openclaw/plugin-sdk/core";
import { ANALYSIS_LOCK_TTL_MS, PROPOSAL_COOLDOWN_MS } from "./config.js";
import {
  createAfterToolCallRawEvent,
  createMessageReceivedRawEvent,
  createMessageSentRawEvent,
  createSessionEndRawEvent,
  createSessionStartRawEvent,
} from "./collector.js";
import { BehaviorObserverStore } from "./db.js";
import { buildEpisodes } from "./episodes.js";
import { compileProposalToDraftRule } from "./execution.js";
import type { BehaviorObserverLogger } from "./log.js";
import { formatError } from "./log.js";
import { minePatterns } from "./miner.js";
import { normalizeRawEvent } from "./normalizers.js";
import { buildProposalRecord, shouldCreateProposal } from "./proposals.js";
import type {
  AnalysisRunSummary,
  ApprovalDecision,
  BehaviorObserverConfig,
  ProposalRecord,
  ProposalStatus,
  RawEventRecord,
} from "./types.js";
import { shortHash, stableStringify } from "./util.js";

export class BehaviorObserverManager {
  private readonly config: BehaviorObserverConfig;
  private readonly logger: BehaviorObserverLogger;
  private readonly resolveBaseStateDir: (() => string | undefined) | undefined;
  private fallbackStateDir: string | null = null;
  private store: BehaviorObserverStore | null = null;

  constructor(params: {
    config: BehaviorObserverConfig;
    logger: BehaviorObserverLogger;
    resolveBaseStateDir?: () => string | undefined;
  }) {
    this.config = params.config;
    this.logger = params.logger;
    this.resolveBaseStateDir = params.resolveBaseStateDir;
  }

  setFallbackStateDir(stateDir: string): void {
    this.fallbackStateDir = stateDir;
    if (!this.store) {
      return;
    }
    if (this.store.getDatabasePath().startsWith(stateDir)) {
      return;
    }
    this.store.close();
    this.store = null;
  }

  close(): void {
    this.store?.close();
    this.store = null;
  }

  private getStore(): BehaviorObserverStore {
    const baseStateDir = this.resolveBaseStateDir?.() ?? this.fallbackStateDir;
    if (!baseStateDir) {
      throw new Error("behavior-observer stateDir is unavailable");
    }
    if (!this.store) {
      this.store = new BehaviorObserverStore(baseStateDir);
    }
    return this.store;
  }

  private collect(rawEvent: RawEventRecord): void {
    if (!this.config.enabled) {
      return;
    }
    try {
      const inserted = this.getStore().recordRawEvent(rawEvent);
      if (!inserted) {
        this.logger.debug(`deduped raw event ${rawEvent.rawEventId}`);
      }
    } catch (err) {
      this.logger.warn(`collector failed: ${formatError(err)}`);
    }
  }

  captureMessageReceived(event: PluginHookMessageReceivedEvent, ctx: PluginHookMessageContext): void {
    this.collect(createMessageReceivedRawEvent(event, ctx));
  }

  captureMessageSent(event: PluginHookMessageSentEvent, ctx: PluginHookMessageContext): void {
    this.collect(createMessageSentRawEvent(event, ctx));
  }

  captureAfterToolCall(
    event: PluginHookAfterToolCallEvent,
    ctx: PluginHookToolContext,
  ): void {
    this.collect(createAfterToolCallRawEvent(event, ctx));
  }

  captureSessionStart(event: PluginHookSessionStartEvent, ctx: PluginHookSessionContext): void {
    this.collect(createSessionStartRawEvent(event, ctx));
  }

  captureSessionEnd(event: PluginHookSessionEndEvent, ctx: PluginHookSessionContext): void {
    this.collect(createSessionEndRawEvent(event, ctx));
  }

  runAnalysis(reason: string = "timer"): AnalysisRunSummary {
    if (!this.config.enabled) {
      return {
        normalizedRawEvents: 0,
        createdActions: 0,
        episodes: 0,
        strongPatterns: 0,
        proposalsCreated: 0,
      };
    }

    const store = this.getStore();
    const now = Date.now();
    const ownerId = shortHash(`${process.pid}:${reason}:${now}`);
    const lockKey = "analysis.lock";
    const acquired = store.tryAcquireLock(lockKey, ownerId, now, ANALYSIS_LOCK_TTL_MS);
    if (!acquired) {
      this.logger.debug("analysis skipped because another run still holds the lock");
      return {
        normalizedRawEvents: 0,
        createdActions: 0,
        episodes: 0,
        strongPatterns: 0,
        proposalsCreated: 0,
      };
    }

    try {
      const rawEvents = store.listUnnormalizedRawEvents();
      const actions = rawEvents.flatMap((rawEvent) => normalizeRawEvent(rawEvent));
      store.insertNormalizedActions(actions);

      const retainedActionCutoff = now - this.config.retentionDaysActions * 24 * 60 * 60_000;
      const retainedActions = store.listRetainedActions(retainedActionCutoff);
      const episodeBuild = buildEpisodes(retainedActions, this.config);
      store.replaceEpisodes(episodeBuild.episodes, episodeBuild.episodeActions);

      const strongPatterns = minePatterns(episodeBuild.materializedEpisodes, this.config, now);
      store.replacePatterns(strongPatterns);

      let proposalsCreated = 0;
      for (const pattern of strongPatterns) {
        const conflict = store.findProposalConflict(pattern.patternId, now, PROPOSAL_COOLDOWN_MS);
        if (!shouldCreateProposal(conflict)) {
          continue;
        }
        const proposal = buildProposalRecord(pattern, now);
        if (store.insertProposal(proposal)) {
          proposalsCreated += 1;
        }
      }

      store.cleanupRetention(this.config, now);
      store.setCheckpoint(
        "analysis.last_run",
        stableStringify({
          ts: now,
          reason,
          rawEvents: rawEvents.length,
          actions: actions.length,
          episodes: episodeBuild.episodes.length,
          patterns: strongPatterns.length,
          proposalsCreated,
        }),
      );

      this.logger.info(
        `analysis complete reason=${reason} raw=${rawEvents.length} actions=${actions.length} episodes=${episodeBuild.episodes.length} patterns=${strongPatterns.length} proposals=${proposalsCreated}`,
      );

      return {
        normalizedRawEvents: rawEvents.length,
        createdActions: actions.length,
        episodes: episodeBuild.episodes.length,
        strongPatterns: strongPatterns.length,
        proposalsCreated,
      };
    } finally {
      store.releaseLock(lockKey, ownerId);
    }
  }

  listPatternsAndProposals(): {
    proposals: ReturnType<BehaviorObserverStore["listRecentProposals"]>;
    patterns: ReturnType<BehaviorObserverStore["listPatterns"]>;
  } {
    const store = this.getStore();
    return {
      proposals: store.listRecentProposals(),
      patterns: store.listPatterns(),
    };
  }

  getProposalDetail(proposalId: string): {
    proposal: ProposalRecord;
    pattern: ReturnType<BehaviorObserverStore["getPattern"]>;
    latestApproval: ReturnType<BehaviorObserverStore["getLatestApproval"]>;
  } | null {
    const store = this.getStore();
    const proposal = store.getProposal(proposalId);
    if (!proposal) {
      return null;
    }
    return {
      proposal,
      pattern: store.getPattern(proposal.patternId),
      latestApproval: store.getLatestApproval(proposalId),
    };
  }

  recordDecision(params: {
    proposalId: string;
    decision: ApprovalDecision;
    scope?: Record<string, unknown> | null;
  }): { ok: true; status: ProposalStatus } | { ok: false; message: string } {
    const store = this.getStore();
    const proposal = store.getProposal(params.proposalId);
    if (!proposal) {
      return { ok: false, message: "Proposal not found." };
    }

    store.recordApproval({
      proposalId: params.proposalId,
      ts: Date.now(),
      decision: params.decision,
      scope: params.scope ?? null,
    });

    const status: ProposalStatus = params.decision === "deny" ? "denied" : "accepted";
    store.updateProposalStatus(params.proposalId, status);
    return { ok: true, status };
  }

  installProposal(proposalId: string): { ok: true; ruleId: string } | { ok: false; message: string } {
    const store = this.getStore();
    const proposal = store.getProposal(proposalId);
    if (!proposal) {
      return { ok: false, message: "Proposal not found." };
    }
    const latestApproval = store.getLatestApproval(proposalId);
    if (!latestApproval || latestApproval.decision === "deny") {
      return { ok: false, message: "Proposal must be approved before install." };
    }

    const compiledRule = compileProposalToDraftRule(proposal);
    store.insertExecution({
      executionId: `exec_${proposalId}_${Date.now()}`,
      ruleId: compiledRule.ruleId,
      proposalId,
      ts: Date.now(),
      status: "installed_draft",
      log: {
        mode: "mvp_draft_only",
        compiledRule,
      },
    });
    store.updateProposalStatus(proposalId, "installed");
    return { ok: true, ruleId: compiledRule.ruleId };
  }

  getDatabasePath(): string {
    return this.getStore().getDatabasePath();
  }
}
