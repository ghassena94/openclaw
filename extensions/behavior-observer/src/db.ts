import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { BehaviorObserverConfig, PersistedPatternRecord, ProposalRecord, RawEventRecord } from "./types.js";
import type { ApprovalDecision, ApprovalRecord, ExecutionRecord, JsonRecord, NormalizedActionRecord, ProposalStatus } from "./types.js";
import { runMigrations } from "./migrations.js";
import { openSqliteDatabase } from "./sqlite.js";
import { safeJsonParse, stableStringify } from "./util.js";

type LockValue = {
  ownerId: string;
  expiresAt: number;
};

export class BehaviorObserverStore {
  private readonly pluginStateDir: string;
  private readonly dbPath: string;
  private db: DatabaseSync | null = null;

  constructor(baseStateDir: string) {
    this.pluginStateDir = path.join(baseStateDir, "plugins", "behavior-observer");
    this.dbPath = path.join(this.pluginStateDir, "behavior-observer.sqlite");
  }

  getDatabasePath(): string {
    return this.dbPath;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private getDb(): DatabaseSync {
    if (!this.db) {
      fs.mkdirSync(this.pluginStateDir, { recursive: true });
      this.db = openSqliteDatabase(this.dbPath);
      runMigrations(this.db);
    }
    return this.db;
  }

  recordRawEvent(event: RawEventRecord): boolean {
    const db = this.getDb();
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO raw_events (
          raw_event_id, ts, session_key, conversation_id, source_kind, source_name, direction, payload_json
        ) VALUES (
          :rawEventId, :ts, :sessionKey, :conversationId, :sourceKind, :sourceName, :direction, :payloadJson
        )`,
      )
      .run({
        rawEventId: event.rawEventId,
        ts: event.ts,
        sessionKey: event.sessionKey,
        conversationId: event.conversationId,
        sourceKind: event.sourceKind,
        sourceName: event.sourceName,
        direction: event.direction,
        payloadJson: stableStringify(event.payload),
      });
    return Number(result.changes ?? 0) > 0;
  }

  listUnnormalizedRawEvents(limit: number = 5000): RawEventRecord[] {
    const rows = this.getDb()
      .prepare(
        `SELECT
          raw_event_id,
          ts,
          session_key,
          conversation_id,
          source_kind,
          source_name,
          direction,
          payload_json
        FROM raw_events
        WHERE NOT EXISTS (
          SELECT 1
          FROM normalized_actions
          WHERE normalized_actions.raw_event_id = raw_events.raw_event_id
        )
        ORDER BY ts ASC, raw_event_id ASC
        LIMIT :limit`,
      )
      .all({ limit }) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      rawEventId: String(row.raw_event_id),
      ts: Number(row.ts),
      sessionKey: (row.session_key as string | null) ?? null,
      conversationId: (row.conversation_id as string | null) ?? null,
      sourceKind: row.source_kind as RawEventRecord["sourceKind"],
      sourceName: String(row.source_name),
      direction: (row.direction as RawEventRecord["direction"]) ?? null,
      payload: safeJsonParse<JsonRecord>(String(row.payload_json), {}),
    }));
  }

  insertNormalizedActions(actions: NormalizedActionRecord[]): void {
    if (actions.length === 0) {
      return;
    }
    const db = this.getDb();
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO normalized_actions (
        action_id,
        ts,
        session_key,
        conversation_id,
        action_type,
        integration,
        entity_keys_json,
        features_json,
        raw_event_id
      ) VALUES (
        :actionId,
        :ts,
        :sessionKey,
        :conversationId,
        :actionType,
        :integration,
        :entityKeysJson,
        :featuresJson,
        :rawEventId
      )`,
    );

    db.exec("BEGIN IMMEDIATE");
    try {
      for (const action of actions) {
        stmt.run({
          actionId: action.actionId,
          ts: action.ts,
          sessionKey: action.sessionKey,
          conversationId: action.conversationId,
          actionType: action.actionType,
          integration: action.integration,
          entityKeysJson: stableStringify(action.entityKeys),
          featuresJson: stableStringify(action.features),
          rawEventId: action.rawEventId,
        });
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  listRetainedActions(cutoffTs: number): NormalizedActionRecord[] {
    const rows = this.getDb()
      .prepare(
        `SELECT
          action_id,
          ts,
          session_key,
          conversation_id,
          action_type,
          integration,
          entity_keys_json,
          features_json,
          raw_event_id
        FROM normalized_actions
        WHERE ts >= :cutoffTs
        ORDER BY ts ASC, action_id ASC`,
      )
      .all({ cutoffTs }) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      actionId: String(row.action_id),
      ts: Number(row.ts),
      sessionKey: (row.session_key as string | null) ?? null,
      conversationId: (row.conversation_id as string | null) ?? null,
      actionType: String(row.action_type),
      integration: (row.integration as string | null) ?? null,
      entityKeys: safeJsonParse<string[]>(String(row.entity_keys_json ?? "[]"), []),
      features: safeJsonParse<JsonRecord>(String(row.features_json ?? "{}"), {}),
      rawEventId: String(row.raw_event_id),
    }));
  }

  replaceEpisodes(
    episodes: Array<{
      episodeId: string;
      startTs: number;
      endTs: number;
      sessionKey: string | null;
      conversationId: string | null;
      episodeKey: string;
    }>,
    episodeActions: Array<{ episodeId: string; actionId: string; ord: number }>,
  ): void {
    const db = this.getDb();
    const episodeStmt = db.prepare(
      `INSERT INTO episodes (
        episode_id, start_ts, end_ts, session_key, conversation_id, episode_key
      ) VALUES (
        :episodeId, :startTs, :endTs, :sessionKey, :conversationId, :episodeKey
      )`,
    );
    const actionStmt = db.prepare(
      `INSERT INTO episode_actions (
        episode_id, action_id, ord
      ) VALUES (
        :episodeId, :actionId, :ord
      )`,
    );

    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DELETE FROM episode_actions");
      db.exec("DELETE FROM episodes");
      for (const episode of episodes) {
        episodeStmt.run(episode);
      }
      for (const episodeAction of episodeActions) {
        actionStmt.run(episodeAction);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  replacePatterns(patterns: PersistedPatternRecord[]): void {
    const db = this.getDb();
    const stmt = db.prepare(
      `INSERT INTO patterns (
        pattern_id, sequence_json, support, confidence, recency_score, window_sec, last_seen_ts
      ) VALUES (
        :patternId, :sequenceJson, :support, :confidence, :recencyScore, :windowSec, :lastSeenTs
      )`,
    );

    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DELETE FROM patterns");
      for (const pattern of patterns) {
        stmt.run({
          patternId: pattern.patternId,
          sequenceJson: stableStringify(pattern.sequence),
          support: pattern.support,
          confidence: pattern.confidence,
          recencyScore: pattern.recencyScore,
          windowSec: pattern.windowSec,
          lastSeenTs: pattern.lastSeenTs,
        });
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  findProposalConflict(patternId: string, now: number, cooldownMs: number): {
    hasActiveDuplicate: boolean;
    hasDeniedDuplicate: boolean;
    withinCooldown: boolean;
  } {
    const row = this.getDb()
      .prepare(
        `SELECT proposal_id, status, created_ts
        FROM proposals
        WHERE pattern_id = :patternId
        ORDER BY created_ts DESC
        LIMIT 5`,
      )
      .all({ patternId }) as Array<Record<string, unknown>>;

    const activeStatuses = new Set<ProposalStatus>(["new", "accepted", "installed"]);
    let hasActiveDuplicate = false;
    let hasDeniedDuplicate = false;
    let withinCooldown = false;
    for (const entry of row) {
      const status = String(entry.status) as ProposalStatus;
      const createdTs = Number(entry.created_ts);
      if (activeStatuses.has(status)) {
        hasActiveDuplicate = true;
      }
      if (status === "denied") {
        hasDeniedDuplicate = true;
      }
      if (now - createdTs < cooldownMs) {
        withinCooldown = true;
      }
    }
    return { hasActiveDuplicate, hasDeniedDuplicate, withinCooldown };
  }

  insertProposal(proposal: ProposalRecord): boolean {
    const result = this.getDb()
      .prepare(
        `INSERT OR IGNORE INTO proposals (
          proposal_id,
          pattern_id,
          created_ts,
          status,
          evidence_json,
          automation_spec_json,
          user_copy
        ) VALUES (
          :proposalId,
          :patternId,
          :createdTs,
          :status,
          :evidenceJson,
          :automationSpecJson,
          :userCopy
        )`,
      )
      .run({
        proposalId: proposal.proposalId,
        patternId: proposal.patternId,
        createdTs: proposal.createdTs,
        status: proposal.status,
        evidenceJson: stableStringify(proposal.evidence),
        automationSpecJson: stableStringify(proposal.automationSpec),
        userCopy: proposal.userCopy,
      });
    return Number(result.changes ?? 0) > 0;
  }

  listRecentProposals(limit: number = 10): Array<
    ProposalRecord & {
      support: number | null;
      confidence: number | null;
      recencyScore: number | null;
    }
  > {
    const rows = this.getDb()
      .prepare(
        `SELECT
          proposals.proposal_id,
          proposals.pattern_id,
          proposals.created_ts,
          proposals.status,
          proposals.evidence_json,
          proposals.automation_spec_json,
          proposals.user_copy,
          patterns.support,
          patterns.confidence,
          patterns.recency_score
        FROM proposals
        LEFT JOIN patterns ON patterns.pattern_id = proposals.pattern_id
        ORDER BY proposals.created_ts DESC
        LIMIT :limit`,
      )
      .all({ limit }) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      proposalId: String(row.proposal_id),
      patternId: String(row.pattern_id),
      createdTs: Number(row.created_ts),
      status: String(row.status) as ProposalStatus,
      evidence: safeJsonParse<JsonRecord>(String(row.evidence_json), {}),
      automationSpec: safeJsonParse<JsonRecord>(String(row.automation_spec_json), {}),
      userCopy: String(row.user_copy),
      support: row.support == null ? null : Number(row.support),
      confidence: row.confidence == null ? null : Number(row.confidence),
      recencyScore: row.recency_score == null ? null : Number(row.recency_score),
    }));
  }

  listPatterns(limit: number = 10): PersistedPatternRecord[] {
    const rows = this.getDb()
      .prepare(
        `SELECT pattern_id, sequence_json, support, confidence, recency_score, window_sec, last_seen_ts
        FROM patterns
        ORDER BY support DESC, confidence DESC, last_seen_ts DESC
        LIMIT :limit`,
      )
      .all({ limit }) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      patternId: String(row.pattern_id),
      sequence: safeJsonParse<string[]>(String(row.sequence_json), []),
      support: Number(row.support),
      confidence: Number(row.confidence),
      recencyScore: Number(row.recency_score),
      windowSec: Number(row.window_sec),
      lastSeenTs: Number(row.last_seen_ts),
    }));
  }

  getProposal(proposalId: string): ProposalRecord | null {
    const row = this.getDb()
      .prepare(
        `SELECT proposal_id, pattern_id, created_ts, status, evidence_json, automation_spec_json, user_copy
        FROM proposals
        WHERE proposal_id = :proposalId`,
      )
      .get({ proposalId }) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return {
      proposalId: String(row.proposal_id),
      patternId: String(row.pattern_id),
      createdTs: Number(row.created_ts),
      status: String(row.status) as ProposalStatus,
      evidence: safeJsonParse<JsonRecord>(String(row.evidence_json), {}),
      automationSpec: safeJsonParse<JsonRecord>(String(row.automation_spec_json), {}),
      userCopy: String(row.user_copy),
    };
  }

  getPattern(patternId: string): PersistedPatternRecord | null {
    const row = this.getDb()
      .prepare(
        `SELECT pattern_id, sequence_json, support, confidence, recency_score, window_sec, last_seen_ts
        FROM patterns
        WHERE pattern_id = :patternId`,
      )
      .get({ patternId }) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return {
      patternId: String(row.pattern_id),
      sequence: safeJsonParse<string[]>(String(row.sequence_json), []),
      support: Number(row.support),
      confidence: Number(row.confidence),
      recencyScore: Number(row.recency_score),
      windowSec: Number(row.window_sec),
      lastSeenTs: Number(row.last_seen_ts),
    };
  }

  updateProposalStatus(proposalId: string, status: ProposalStatus): boolean {
    const result = this.getDb()
      .prepare(`UPDATE proposals SET status = :status WHERE proposal_id = :proposalId`)
      .run({ proposalId, status });
    return Number(result.changes ?? 0) > 0;
  }

  recordApproval(params: {
    proposalId: string;
    ts: number;
    decision: ApprovalDecision;
    scope: JsonRecord | null;
  }): ApprovalRecord {
    const approvalId = `approval_${params.proposalId}_${params.ts}_${params.decision}`;
    this.getDb()
      .prepare(
        `INSERT INTO approvals (
          approval_id, proposal_id, ts, decision, scope_json
        ) VALUES (
          :approvalId, :proposalId, :ts, :decision, :scopeJson
        )`,
      )
      .run({
        approvalId,
        proposalId: params.proposalId,
        ts: params.ts,
        decision: params.decision,
        scopeJson: params.scope == null ? null : stableStringify(params.scope),
      });
    return {
      approvalId,
      proposalId: params.proposalId,
      ts: params.ts,
      decision: params.decision,
      scope: params.scope,
    };
  }

  getLatestApproval(proposalId: string): ApprovalRecord | null {
    const row = this.getDb()
      .prepare(
        `SELECT approval_id, proposal_id, ts, decision, scope_json
        FROM approvals
        WHERE proposal_id = :proposalId
        ORDER BY ts DESC
        LIMIT 1`,
      )
      .get({ proposalId }) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return {
      approvalId: String(row.approval_id),
      proposalId: String(row.proposal_id),
      ts: Number(row.ts),
      decision: String(row.decision) as ApprovalDecision,
      scope: row.scope_json == null ? null : safeJsonParse<JsonRecord>(String(row.scope_json), {}),
    };
  }

  insertExecution(record: ExecutionRecord): void {
    this.getDb()
      .prepare(
        `INSERT INTO executions (
          execution_id, rule_id, proposal_id, ts, status, log_json
        ) VALUES (
          :executionId, :ruleId, :proposalId, :ts, :status, :logJson
        )`,
      )
      .run({
        executionId: record.executionId,
        ruleId: record.ruleId,
        proposalId: record.proposalId,
        ts: record.ts,
        status: record.status,
        logJson: stableStringify(record.log),
      });
  }

  tryAcquireLock(key: string, ownerId: string, now: number, ttlMs: number): boolean {
    const db = this.getDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare(`SELECT value FROM checkpoints WHERE key = :key`).get({ key }) as
        | { value?: string }
        | undefined;
      const current = row?.value ? safeJsonParse<LockValue | null>(row.value, null) : null;
      if (current && typeof current.expiresAt === "number" && current.expiresAt > now) {
        db.exec("COMMIT");
        return false;
      }

      const next: LockValue = { ownerId, expiresAt: now + ttlMs };
      db.prepare(
        `INSERT INTO checkpoints (key, value)
        VALUES (:key, :value)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ).run({
        key,
        value: stableStringify(next),
      });
      db.exec("COMMIT");
      return true;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  releaseLock(key: string, ownerId: string): void {
    const row = this.getDb()
      .prepare(`SELECT value FROM checkpoints WHERE key = :key`)
      .get({ key }) as { value?: string } | undefined;
    const current = row?.value ? safeJsonParse<LockValue | null>(row.value, null) : null;
    if (!current || current.ownerId !== ownerId) {
      return;
    }
    this.getDb().prepare(`DELETE FROM checkpoints WHERE key = :key`).run({ key });
  }

  setCheckpoint(key: string, value: string): void {
    this.getDb()
      .prepare(
        `INSERT INTO checkpoints (key, value)
        VALUES (:key, :value)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run({ key, value });
  }

  getCheckpoint(key: string): string | null {
    const row = this.getDb()
      .prepare(`SELECT value FROM checkpoints WHERE key = :key`)
      .get({ key }) as { value?: string } | undefined;
    return row?.value ? String(row.value) : null;
  }

  cleanupRetention(config: BehaviorObserverConfig, now: number = Date.now()): void {
    const rawCutoffTs = now - config.retentionDaysRaw * 24 * 60 * 60_000;
    const actionCutoffTs = now - config.retentionDaysActions * 24 * 60 * 60_000;
    const db = this.getDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`DELETE FROM normalized_actions WHERE ts < :actionCutoffTs`).run({ actionCutoffTs });
      db.prepare(
        `DELETE FROM raw_events
        WHERE ts < :rawCutoffTs
          AND NOT EXISTS (
            SELECT 1
            FROM normalized_actions
            WHERE normalized_actions.raw_event_id = raw_events.raw_event_id
          )`,
      ).run({ rawCutoffTs });
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
