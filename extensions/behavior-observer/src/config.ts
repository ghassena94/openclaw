import type { BehaviorObserverConfig } from "./types.js";

export const DEFAULT_BEHAVIOR_OBSERVER_CONFIG: BehaviorObserverConfig = {
  enabled: true,
  analyzerIntervalSec: 3600,
  episodeGapMinutes: 45,
  minSupport: 3,
  minConfidence: 0.6,
  maxPatternLength: 4,
  retentionDaysRaw: 30,
  retentionDaysActions: 90,
};

export const ANALYSIS_LOCK_TTL_MS = 15 * 60_000;
export const PROPOSAL_COOLDOWN_MS = 7 * 24 * 60 * 60_000;

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function coercePositiveNumber(value: unknown, fallback: number, min: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, value);
}

export function resolveBehaviorObserverConfig(value: unknown): BehaviorObserverConfig {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    enabled: coerceBoolean(record.enabled, DEFAULT_BEHAVIOR_OBSERVER_CONFIG.enabled),
    analyzerIntervalSec: coercePositiveNumber(
      record.analyzerIntervalSec,
      DEFAULT_BEHAVIOR_OBSERVER_CONFIG.analyzerIntervalSec,
      30,
    ),
    episodeGapMinutes: coercePositiveNumber(
      record.episodeGapMinutes,
      DEFAULT_BEHAVIOR_OBSERVER_CONFIG.episodeGapMinutes,
      1,
    ),
    minSupport: Math.round(
      coercePositiveNumber(record.minSupport, DEFAULT_BEHAVIOR_OBSERVER_CONFIG.minSupport, 1),
    ),
    minConfidence: Math.min(
      1,
      coercePositiveNumber(
        record.minConfidence,
        DEFAULT_BEHAVIOR_OBSERVER_CONFIG.minConfidence,
        0.01,
      ),
    ),
    maxPatternLength: Math.min(
      4,
      Math.round(
        coercePositiveNumber(
          record.maxPatternLength,
          DEFAULT_BEHAVIOR_OBSERVER_CONFIG.maxPatternLength,
          2,
        ),
      ),
    ),
    retentionDaysRaw: Math.round(
      coercePositiveNumber(
        record.retentionDaysRaw,
        DEFAULT_BEHAVIOR_OBSERVER_CONFIG.retentionDaysRaw,
        1,
      ),
    ),
    retentionDaysActions: Math.round(
      coercePositiveNumber(
        record.retentionDaysActions,
        DEFAULT_BEHAVIOR_OBSERVER_CONFIG.retentionDaysActions,
        1,
      ),
    ),
  };
}
