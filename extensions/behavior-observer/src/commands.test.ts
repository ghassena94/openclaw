import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  OpenClawPluginApi,
  OpenClawPluginCommandDefinition,
  PluginCommandContext,
} from "openclaw/plugin-sdk/core";
import { describe, expect, it } from "vitest";
import { createTestPluginApi } from "../../../test/helpers/extensions/plugin-api.js";
import registerBehaviorObserver from "../index.js";
import { BehaviorObserverStore } from "./db.js";

function createCommandContext(commandBody: string, args: string): PluginCommandContext {
  return {
    channel: "slack",
    channelId: "slack",
    isAuthorizedSender: true,
    commandBody,
    args,
    config: {},
    senderId: "user-1",
    requestConversationBinding: async () => ({ status: "error", message: "unsupported" }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
  };
}

describe("behavior-observer commands", () => {
  it("records approval, denial, and install flow through plugin commands", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "behavior-observer-commands-"));
    try {
      const commands = new Map<string, OpenClawPluginCommandDefinition>();
      const services: Array<{ start: Function; stop?: Function }> = [];
      const api = createTestPluginApi({
        id: "behavior-observer",
        name: "behavior-observer",
        source: "test",
        config: {},
        pluginConfig: {},
        runtime: {
          state: {
            resolveStateDir: () => stateDir,
          },
        } as OpenClawPluginApi["runtime"],
        registerCommand: (command: OpenClawPluginCommandDefinition) => {
          commands.set(command.name, command);
        },
        registerService: (service) => {
          services.push(service);
        },
      }) as OpenClawPluginApi;

      registerBehaviorObserver.register(api);
      await services[0]?.start?.({ config: {}, stateDir, logger: api.logger });

      const store = new BehaviorObserverStore(stateDir);
      store.replacePatterns([
        {
          patternId: "pat-1",
          sequence: ["message.received", "calendar.event.created"],
          support: 3,
          confidence: 0.8,
          recencyScore: 0.9,
          windowSec: 30,
          lastSeenTs: 1_700_000_000_000,
        },
      ]);
      store.insertProposal({
        proposalId: "prop-1",
        patternId: "pat-1",
        createdTs: 1_700_000_000_000,
        status: "new",
        evidence: { support: 3, confidence: 0.8 },
        automationSpec: { trigger: { actionType: "message.received" }, steps: [] },
        userCopy: "Test copy",
      });

      const patternCommand = commands.get("pattern");
      expect(patternCommand).toBeTruthy();

      const approve = await patternCommand?.handler(
        createCommandContext("/pattern approve prop-1", "approve prop-1"),
      );
      expect(String(approve?.text)).toContain("approved");

      const install = await patternCommand?.handler(
        createCommandContext("/pattern install prop-1", "install prop-1"),
      );
      expect(String(install?.text)).toContain("marked installed");

      const explain = await patternCommand?.handler(
        createCommandContext("/pattern explain prop-1", "explain prop-1"),
      );
      expect(String(explain?.text)).toContain("Proposal: prop-1");

      const deny = await patternCommand?.handler(
        createCommandContext("/pattern deny prop-1", "deny prop-1"),
      );
      expect(String(deny?.text)).toContain("denied");

      store.close();
      await services[0]?.stop?.({ config: {}, stateDir, logger: api.logger });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });
});
