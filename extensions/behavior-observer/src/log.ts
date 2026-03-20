import type { PluginLogger } from "openclaw/plugin-sdk/core";

const PREFIX = "[behavior-observer]";

export type BehaviorObserverLogger = {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export function createBehaviorObserverLogger(logger: PluginLogger): BehaviorObserverLogger {
  const prefix = (message: string) => `${PREFIX} ${message}`;
  return {
    debug: (message: string) => logger.debug?.(prefix(message)),
    info: (message: string) => logger.info(prefix(message)),
    warn: (message: string) => logger.warn(prefix(message)),
    error: (message: string) => logger.error(prefix(message)),
  };
}

export function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack?.trim() || err.message;
  }
  return String(err);
}
