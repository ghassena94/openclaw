export type BehaviorObserverConfig = {
  enabled: boolean;
  analyzerIntervalSec: number;
  episodeGapMinutes: number;
  minSupport: number;
  minConfidence: number;
  maxPatternLength: number;
  retentionDaysRaw: number;
  retentionDaysActions: number;
};

export type RawEventSourceKind = "tool" | "message" | "webhook" | "session";
export type RawEventDirection = "in" | "out" | null;
export type ProposalStatus = "new" | "accepted" | "denied" | "installed";
export type ApprovalDecision = "allow_once" | "always_allow" | "deny";

export type JsonRecord = Record<string, unknown>;

export type RawEventRecord = {
  rawEventId: string;
  ts: number;
  sessionKey: string | null;
  conversationId: string | null;
  sourceKind: RawEventSourceKind;
  sourceName: string;
  direction: RawEventDirection;
  payload: JsonRecord;
};

export type NormalizedActionRecord = {
  actionId: string;
  ts: number;
  sessionKey: string | null;
  conversationId: string | null;
  actionType: string;
  integration: string | null;
  entityKeys: string[];
  features: JsonRecord;
  rawEventId: string;
};

export type EpisodeRecord = {
  episodeId: string;
  startTs: number;
  endTs: number;
  sessionKey: string | null;
  conversationId: string | null;
  episodeKey: string;
};

export type EpisodeActionRecord = {
  episodeId: string;
  actionId: string;
  ord: number;
};

export type MaterializedEpisode = EpisodeRecord & {
  actionIds: string[];
  actionTypes: string[];
  entityKeys: string[];
};

export type PersistedPatternRecord = {
  patternId: string;
  sequence: string[];
  support: number;
  confidence: number;
  recencyScore: number;
  windowSec: number;
  lastSeenTs: number;
};

export type MinedPattern = PersistedPatternRecord & {
  exampleEpisodeIds: string[];
  recentEpisodeTimestamps: number[];
};

export type ProposalRecord = {
  proposalId: string;
  patternId: string;
  createdTs: number;
  status: ProposalStatus;
  evidence: JsonRecord;
  automationSpec: JsonRecord;
  userCopy: string;
};

export type ApprovalRecord = {
  approvalId: string;
  proposalId: string;
  ts: number;
  decision: ApprovalDecision;
  scope: JsonRecord | null;
};

export type ExecutionRecord = {
  executionId: string;
  ruleId: string | null;
  proposalId: string | null;
  ts: number;
  status: string;
  log: JsonRecord;
};

export type CheckpointRecord = {
  key: string;
  value: string;
};

export type NormalizationAdapter = {
  name: string;
  matches: (rawEvent: RawEventRecord) => boolean;
  toActions: (rawEvent: RawEventRecord) => NormalizedActionRecord[];
};

export type AnalysisRunSummary = {
  normalizedRawEvents: number;
  createdActions: number;
  episodes: number;
  strongPatterns: number;
  proposalsCreated: number;
};
