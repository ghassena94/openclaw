# Behavior Observer

`behavior-observer` is an MVP learning plugin for OpenClaw. It watches
OpenClaw-observable message, session, and tool activity, learns repeated
multi-step workflows, and creates approval-gated automation proposals.

It is intentionally conservative:

- it only learns from events OpenClaw can already observe
- it stores minimized and redacted data
- it never executes side effects without explicit approval

## What The Plugin Does

The plugin runs in five stages:

1. Collect hook events from the OpenClaw runtime.
2. Normalize low-level events into canonical actions.
3. Build action episodes using session, conversation, and time-gap grouping.
4. Mine repeated ordered sequences of length 2 to 4.
5. Create deterministic automation proposals with an approval gate.

### Hook Coverage

The MVP collector listens to:

- `message_received`
- `message_sent`
- `after_tool_call`
- `session_start`
- `session_end`

### Canonical Actions

The shipped adapters produce these action families:

- `message.received`
- `message.sent`
- `calendar.event.created`
- `calendar.event.updated`
- `task.created`
- `automation.created`
- `tool.<toolName>.used`
- `session.started`
- `session.ended`

These are adapter-based and can be extended later for webhooks, skills, or
additional integrations.

## MVP Scope And Limitations

- It only learns from events OpenClaw can already observe today.
- It does not claim native Notion, Jira, or CRM support.
- It does not use embeddings, vector search, or heavy ML.
- It does not auto-execute external side effects.
- `install` is metadata-only in MVP. A future version can compile approved
  proposals into Lobster or webhook-driven rules.

## Safety Model

- Raw hook payloads are minimized and redacted before storage.
- Message bodies are not stored verbatim. The plugin stores hashes, lengths,
  and selected metadata only.
- Tool payloads are summarized to hashes, top-level keys, and safe entity
  hints.
- Proposal generation is deterministic and threshold-based.
- No proposal executes anything without explicit user approval.
- Denied or recently proposed workflows are cooled down to avoid spam.
- Collector and analyzer failures are logged and do not break the main user
  flow.

## Configuration

The plugin manifest exposes this config schema:

```json
{
  "enabled": true,
  "analyzerIntervalSec": 3600,
  "episodeGapMinutes": 45,
  "minSupport": 3,
  "minConfidence": 0.6,
  "maxPatternLength": 4,
  "retentionDaysRaw": 30,
  "retentionDaysActions": 90
}
```

### Config Notes

- `analyzerIntervalSec`: how often the background analyzer runs.
- `episodeGapMinutes`: split episodes when inactivity exceeds this gap.
- `minSupport`: minimum number of repeated observations before a pattern is
  considered.
- `minConfidence`: minimum confidence threshold for proposal generation.
- `maxPatternLength`: longest mined ordered sequence.
- `retentionDaysRaw`: retention window for minimized raw events.
- `retentionDaysActions`: retention window for normalized actions and derived
  records.

## Installation

From the OpenClaw repository root:

```bash
pnpm install --no-frozen-lockfile --ignore-scripts
```

Then enable the plugin in your OpenClaw plugin configuration:

```json
{
  "plugins": {
    "entries": {
      "behavior-observer": {
        "enabled": true,
        "config": {
          "enabled": true,
          "analyzerIntervalSec": 3600,
          "episodeGapMinutes": 45,
          "minSupport": 3,
          "minConfidence": 0.6,
          "maxPatternLength": 4,
          "retentionDaysRaw": 30,
          "retentionDaysActions": 90
        }
      }
    }
  }
}
```

If you are installing the plugin from outside this checkout, use the normal
OpenClaw plugin installation flow and point it at this folder.

## Commands

- `/patterns`
  - Lists recent proposals and currently strong learned patterns.
- `/pattern approve <proposalId> [once|always]`
  - Records approval and marks the proposal accepted.
- `/pattern deny <proposalId>`
  - Records denial and marks the proposal denied.
- `/pattern install <proposalId>`
  - Marks an approved proposal installed. MVP does not execute side effects.
- `/pattern explain <proposalId>`
  - Shows evidence, scores, and the draft automation spec.

## How To Test

### Automated Tests

Run the plugin test suite from the repository root:

```bash
pnpm exec vitest run --config vitest.extensions.config.ts extensions/behavior-observer/src/*.test.ts
```

The tests cover:

- SQLite migrations
- collector dedupe behavior
- action normalization adapters
- episode splitting
- sequence mining and scoring
- proposal dedupe and cooldown
- approval and install command flows

### Manual Smoke Test

1. Enable the plugin with a short analyzer interval, for example
   `analyzerIntervalSec: 15`.
2. Perform the same workflow shape at least twice from a tool-enabled chat
   surface.
3. Example workflow:
   - send a message that triggers a calendar event creation
   - then trigger a reminder or task creation
4. Ask OpenClaw for:
   - `/patterns`
   - `/pattern explain <proposalId>`
5. Approve and install the proposal:
   - `/pattern approve <proposalId>`
   - `/pattern install <proposalId>`

Expected MVP result:

- a proposal is created after the repeated pattern crosses thresholds
- approval is recorded
- installation is recorded
- no external side effect is executed automatically

## Storage

The plugin uses a local SQLite database under the OpenClaw state directory:

- `plugins/behavior-observer/behavior-observer.sqlite`

The database runs in WAL mode and uses explicit migrations.

Primary persisted tables:

- `raw_events`
- `normalized_actions`
- `episodes`
- `episode_actions`
- `patterns`
- `proposals`
- `approvals`
- `executions`
- `checkpoints`

## Development Notes

- The SQLite adapter is isolated so a fallback can be added later if
  `node:sqlite` is unavailable in some environments.
- The miner is deterministic by design. There is no LLM dependency for
  proposal generation in MVP.
- The execution layer is intentionally shallow. It defines the compile/install
  boundary without running external automations automatically.

## Future Adapters

The normalization layer is adapter-based so future versions can add:

- webhook adapters for Notion, Jira, CRM, and internal app events
- skill-specific action adapters
- Lobster compilation for approved rules
- Slack, Telegram, and Discord button handlers for proposal approval
