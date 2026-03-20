import type { DatabaseSync } from "node:sqlite";

type Migration = {
  version: number;
  statements: string[];
};

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS raw_events (
        raw_event_id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        session_key TEXT,
        conversation_id TEXT,
        source_kind TEXT NOT NULL,
        source_name TEXT NOT NULL,
        direction TEXT,
        payload_json TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS normalized_actions (
        action_id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        session_key TEXT,
        conversation_id TEXT,
        action_type TEXT NOT NULL,
        integration TEXT,
        entity_keys_json TEXT,
        features_json TEXT,
        raw_event_id TEXT NOT NULL REFERENCES raw_events(raw_event_id)
      )`,
      `CREATE TABLE IF NOT EXISTS episodes (
        episode_id TEXT PRIMARY KEY,
        start_ts INTEGER NOT NULL,
        end_ts INTEGER NOT NULL,
        session_key TEXT,
        conversation_id TEXT,
        episode_key TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS episode_actions (
        episode_id TEXT NOT NULL REFERENCES episodes(episode_id),
        action_id TEXT NOT NULL REFERENCES normalized_actions(action_id),
        ord INTEGER NOT NULL,
        PRIMARY KEY (episode_id, ord)
      )`,
      `CREATE TABLE IF NOT EXISTS patterns (
        pattern_id TEXT PRIMARY KEY,
        sequence_json TEXT NOT NULL,
        support INTEGER NOT NULL,
        confidence REAL NOT NULL,
        recency_score REAL NOT NULL,
        window_sec INTEGER NOT NULL,
        last_seen_ts INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS proposals (
        proposal_id TEXT PRIMARY KEY,
        pattern_id TEXT NOT NULL REFERENCES patterns(pattern_id),
        created_ts INTEGER NOT NULL,
        status TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        automation_spec_json TEXT NOT NULL,
        user_copy TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS approvals (
        approval_id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL REFERENCES proposals(proposal_id),
        ts INTEGER NOT NULL,
        decision TEXT NOT NULL,
        scope_json TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS executions (
        execution_id TEXT PRIMARY KEY,
        rule_id TEXT,
        proposal_id TEXT,
        ts INTEGER NOT NULL,
        status TEXT NOT NULL,
        log_json TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS checkpoints (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_raw_events_ts ON raw_events(ts)`,
      `CREATE INDEX IF NOT EXISTS idx_raw_events_session_key ON raw_events(session_key, ts)`,
      `CREATE INDEX IF NOT EXISTS idx_raw_events_conversation_id ON raw_events(conversation_id, ts)`,
      `CREATE INDEX IF NOT EXISTS idx_raw_events_source_kind ON raw_events(source_kind, source_name, ts)`,
      `CREATE INDEX IF NOT EXISTS idx_normalized_actions_ts ON normalized_actions(ts)`,
      `CREATE INDEX IF NOT EXISTS idx_normalized_actions_session_key ON normalized_actions(session_key, ts)`,
      `CREATE INDEX IF NOT EXISTS idx_normalized_actions_conversation_id ON normalized_actions(conversation_id, ts)`,
      `CREATE INDEX IF NOT EXISTS idx_normalized_actions_action_type ON normalized_actions(action_type, ts)`,
      `CREATE INDEX IF NOT EXISTS idx_normalized_actions_raw_event_id ON normalized_actions(raw_event_id)`,
      `CREATE INDEX IF NOT EXISTS idx_episodes_start_ts ON episodes(start_ts, end_ts)`,
      `CREATE INDEX IF NOT EXISTS idx_episodes_session_key ON episodes(session_key, start_ts)`,
      `CREATE INDEX IF NOT EXISTS idx_episodes_conversation_id ON episodes(conversation_id, start_ts)`,
      `CREATE INDEX IF NOT EXISTS idx_episode_actions_action_id ON episode_actions(action_id)`,
      `CREATE INDEX IF NOT EXISTS idx_patterns_last_seen_ts ON patterns(last_seen_ts)`,
      `CREATE INDEX IF NOT EXISTS idx_proposals_pattern_id ON proposals(pattern_id, created_ts)`,
      `CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status, created_ts)`,
      `CREATE INDEX IF NOT EXISTS idx_approvals_proposal_id ON approvals(proposal_id, ts)`,
      `CREATE INDEX IF NOT EXISTS idx_executions_proposal_id ON executions(proposal_id, ts)`,
      `CREATE INDEX IF NOT EXISTS idx_executions_rule_id ON executions(rule_id, ts)`,
    ],
  },
];

function currentUserVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  return Number(row?.user_version ?? 0);
}

export function runMigrations(db: DatabaseSync): void {
  const current = currentUserVersion(db);
  const pending = MIGRATIONS.filter((migration) => migration.version > current).sort(
    (left, right) => left.version - right.version,
  );

  if (pending.length === 0) {
    return;
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const migration of pending) {
      for (const statement of migration.statements) {
        db.exec(statement);
      }
      db.exec(`PRAGMA user_version = ${migration.version}`);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
