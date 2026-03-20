import {
  definePluginEntry,
  type OpenClawPluginApi,
  type OpenClawPluginService,
} from "openclaw/plugin-sdk/core";
import { resolveBehaviorObserverConfig } from "./src/config.js";
import { registerBehaviorObserverCommands } from "./src/commands.js";
import { createBehaviorObserverLogger, formatError } from "./src/log.js";
import { BehaviorObserverManager } from "./src/service.js";

export default definePluginEntry({
  id: "behavior-observer",
  name: "Behavior Observer",
  description:
    "Learns repeated action sequences from OpenClaw-observable events and proposes safe automation drafts.",
  register(api: OpenClawPluginApi) {
    const config = resolveBehaviorObserverConfig(api.pluginConfig);
    const logger = createBehaviorObserverLogger(api.logger);
    const manager = new BehaviorObserverManager({
      config,
      logger,
      resolveBaseStateDir: () => api.runtime.state.resolveStateDir(),
    });

    const service: OpenClawPluginService = {
      id: "behavior-observer-analyzer",
      start: async (ctx) => {
        manager.setFallbackStateDir(ctx.stateDir);
        if (!config.enabled) {
          logger.info("plugin disabled; analyzer service idle");
          return;
        }

        try {
          manager.runAnalysis("startup");
        } catch (err) {
          logger.warn(`startup analysis failed: ${formatError(err)}`);
        }

        const interval = setInterval(() => {
          try {
            manager.runAnalysis("interval");
          } catch (err) {
            logger.warn(`scheduled analysis failed: ${formatError(err)}`);
          }
        }, config.analyzerIntervalSec * 1000);
        interval.unref?.();
        (service as OpenClawPluginService & { _interval?: ReturnType<typeof setInterval> })._interval =
          interval;
      },
      stop: async () => {
        const state = service as OpenClawPluginService & { _interval?: ReturnType<typeof setInterval> };
        if (state._interval) {
          clearInterval(state._interval);
          delete state._interval;
        }
        manager.close();
      },
    };

    api.registerService(service);
    registerBehaviorObserverCommands(api, manager);

    api.on("message_received", async (event, ctx) => {
      manager.captureMessageReceived(event, ctx);
    });
    api.on("message_sent", async (event, ctx) => {
      manager.captureMessageSent(event, ctx);
    });
    api.on("after_tool_call", async (event, ctx) => {
      manager.captureAfterToolCall(event, ctx);
    });
    api.on("session_start", async (event, ctx) => {
      manager.captureSessionStart(event, ctx);
    });
    api.on("session_end", async (event, ctx) => {
      manager.captureSessionEnd(event, ctx);
    });
  },
});
