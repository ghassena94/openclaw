import type { BehaviorObserverConfig, MaterializedEpisode, MinedPattern } from "./types.js";
import { sha256 } from "./util.js";

const HALF_LIFE_MS = 14 * 24 * 60 * 60_000;
const NOISY_ACTIONS = new Set(["session.started", "session.ended"]);

type SequenceAggregate = {
  sequence: string[];
  support: number;
  latestTs: number;
  totalWindowMs: number;
  recencyAccumulator: number;
  episodeIds: string[];
  timestamps: number[];
};

function sequenceKey(sequence: string[]): string {
  return sequence.join(" -> ");
}

function generateEpisodeSequences(actions: string[], maxLength: number): Set<string> {
  const keys = new Set<string>();
  const path: string[] = [];

  const visit = (startIndex: number) => {
    if (path.length > 0) {
      keys.add(sequenceKey(path));
    }
    if (path.length >= maxLength) {
      return;
    }
    for (let index = startIndex; index < actions.length; index += 1) {
      path.push(actions[index]);
      visit(index + 1);
      path.pop();
    }
  };

  visit(0);
  return keys;
}

function parseSequence(sequence: string): string[] {
  return sequence.split(" -> ").filter(Boolean);
}

function isNoisyPattern(sequence: string[]): boolean {
  if (sequence.some((step) => NOISY_ACTIONS.has(step))) {
    return true;
  }
  if (sequence.every((step) => step === "message.received" || step === "message.sent")) {
    return true;
  }
  if (sequence.every((step) => step.startsWith("tool."))) {
    return true;
  }
  return false;
}

export function minePatterns(
  episodes: MaterializedEpisode[],
  config: BehaviorObserverConfig,
  now: number = Date.now(),
): MinedPattern[] {
  const supportBySequence = new Map<string, SequenceAggregate>();
  const prefixSupport = new Map<string, number>();

  for (const episode of episodes) {
    const uniqueSequences = generateEpisodeSequences(episode.actionTypes, config.maxPatternLength);
    for (const encoded of uniqueSequences) {
      const sequence = parseSequence(encoded);
      const aggregate = supportBySequence.get(encoded) ?? {
        sequence,
        support: 0,
        latestTs: 0,
        totalWindowMs: 0,
        recencyAccumulator: 0,
        episodeIds: [],
        timestamps: [],
      };
      aggregate.support += 1;
      aggregate.latestTs = Math.max(aggregate.latestTs, episode.endTs);
      aggregate.totalWindowMs += Math.max(0, episode.endTs - episode.startTs);
      aggregate.recencyAccumulator += Math.exp(-(now - episode.endTs) / HALF_LIFE_MS);
      if (aggregate.episodeIds.length < 5) {
        aggregate.episodeIds.push(episode.episodeId);
      }
      if (aggregate.timestamps.length < 5) {
        aggregate.timestamps.push(episode.endTs);
      }
      supportBySequence.set(encoded, aggregate);

      if (sequence.length >= 1) {
        const prefixKey = sequenceKey(sequence);
        prefixSupport.set(prefixKey, (prefixSupport.get(prefixKey) ?? 0) + 1);
      }
    }
  }

  const strongPatterns: MinedPattern[] = [];
  for (const aggregate of supportBySequence.values()) {
    if (aggregate.sequence.length < 2) {
      continue;
    }
    if (isNoisyPattern(aggregate.sequence)) {
      continue;
    }

    const prefixKey = sequenceKey(aggregate.sequence.slice(0, -1));
    const prefixCount = prefixSupport.get(prefixKey) ?? 0;
    const confidence = prefixCount > 0 ? aggregate.support / prefixCount : 0;
    if (aggregate.support < config.minSupport || confidence < config.minConfidence) {
      continue;
    }

    const patternId = `pat_${sha256(JSON.stringify(aggregate.sequence))}`;
    strongPatterns.push({
      patternId,
      sequence: aggregate.sequence,
      support: aggregate.support,
      confidence,
      recencyScore: aggregate.recencyAccumulator / aggregate.support,
      windowSec: Math.max(1, Math.round(aggregate.totalWindowMs / aggregate.support / 1000)),
      lastSeenTs: aggregate.latestTs,
      exampleEpisodeIds: aggregate.episodeIds,
      recentEpisodeTimestamps: aggregate.timestamps,
    });
  }

  return strongPatterns.sort((left, right) => {
    if (left.support !== right.support) {
      return right.support - left.support;
    }
    if (left.confidence !== right.confidence) {
      return right.confidence - left.confidence;
    }
    return right.lastSeenTs - left.lastSeenTs;
  });
}
