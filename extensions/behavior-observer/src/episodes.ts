import type {
  BehaviorObserverConfig,
  EpisodeActionRecord,
  EpisodeRecord,
  MaterializedEpisode,
  NormalizedActionRecord,
} from "./types.js";
import { sha256, uniqueStrings } from "./util.js";

export type EpisodeBuildResult = {
  episodes: EpisodeRecord[];
  episodeActions: EpisodeActionRecord[];
  materializedEpisodes: MaterializedEpisode[];
};

type WorkingEpisode = {
  sessionKey: string | null;
  conversationId: string | null;
  startTs: number;
  endTs: number;
  episodeKey: string;
  actions: NormalizedActionRecord[];
  entityKeys: Set<string>;
};

function groupingKey(action: NormalizedActionRecord): string {
  return `${action.sessionKey ?? ""}::${action.conversationId ?? ""}`;
}

function entityOverlap(left: Set<string>, right: string[]): boolean {
  return right.some((entry) => left.has(entry));
}

function shouldSplitEpisode(
  current: WorkingEpisode,
  next: NormalizedActionRecord,
  config: BehaviorObserverConfig,
): boolean {
  if (groupingKey(next) !== `${current.sessionKey ?? ""}::${current.conversationId ?? ""}`) {
    return true;
  }

  const gapMs = next.ts - current.endTs;
  const thresholdMs = config.episodeGapMinutes * 60_000;
  if (gapMs <= thresholdMs) {
    return false;
  }

  if (gapMs <= thresholdMs * 2 && entityOverlap(current.entityKeys, next.entityKeys)) {
    return false;
  }

  return true;
}

function materializeEpisode(current: WorkingEpisode): EpisodeBuildResult {
  const orderedActionIds = current.actions.map((action) => action.actionId);
  const episodeId = `ep_${sha256(
    JSON.stringify({
      sessionKey: current.sessionKey,
      conversationId: current.conversationId,
      actionIds: orderedActionIds,
    }),
  )}`;

  const episode: EpisodeRecord = {
    episodeId,
    startTs: current.startTs,
    endTs: current.endTs,
    sessionKey: current.sessionKey,
    conversationId: current.conversationId,
    episodeKey: current.episodeKey,
  };

  const episodeActions: EpisodeActionRecord[] = current.actions.map((action, index) => ({
    episodeId,
    actionId: action.actionId,
    ord: index,
  }));

  const materialized: MaterializedEpisode = {
    ...episode,
    actionIds: orderedActionIds,
    actionTypes: current.actions.map((action) => action.actionType),
    entityKeys: uniqueStrings(current.actions.flatMap((action) => action.entityKeys)),
  };

  return {
    episodes: [episode],
    episodeActions,
    materializedEpisodes: [materialized],
  };
}

export function buildEpisodes(
  actions: NormalizedActionRecord[],
  config: BehaviorObserverConfig,
): EpisodeBuildResult {
  const ordered = [...actions].sort((left, right) =>
    left.ts === right.ts ? left.actionId.localeCompare(right.actionId) : left.ts - right.ts,
  );
  const result: EpisodeBuildResult = {
    episodes: [],
    episodeActions: [],
    materializedEpisodes: [],
  };

  let current: WorkingEpisode | null = null;
  for (const action of ordered) {
    if (!current) {
      current = {
        sessionKey: action.sessionKey,
        conversationId: action.conversationId,
        startTs: action.ts,
        endTs: action.ts,
        episodeKey: groupingKey(action),
        actions: [action],
        entityKeys: new Set(action.entityKeys),
      };
      continue;
    }

    if (shouldSplitEpisode(current, action, config)) {
      const materialized = materializeEpisode(current);
      result.episodes.push(...materialized.episodes);
      result.episodeActions.push(...materialized.episodeActions);
      result.materializedEpisodes.push(...materialized.materializedEpisodes);
      current = {
        sessionKey: action.sessionKey,
        conversationId: action.conversationId,
        startTs: action.ts,
        endTs: action.ts,
        episodeKey: groupingKey(action),
        actions: [action],
        entityKeys: new Set(action.entityKeys),
      };
      continue;
    }

    current.actions.push(action);
    current.endTs = action.ts;
    for (const entityKey of action.entityKeys) {
      current.entityKeys.add(entityKey);
    }
  }

  if (current) {
    const materialized = materializeEpisode(current);
    result.episodes.push(...materialized.episodes);
    result.episodeActions.push(...materialized.episodeActions);
    result.materializedEpisodes.push(...materialized.materializedEpisodes);
  }

  return result;
}
