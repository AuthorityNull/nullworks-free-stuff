# Mem0 Sidecar (`mem0-sidecar`)

## What it does
Adds Mem0-based long-term memory alongside built-in memory, with:
- auto-recall before agent runs
- auto-capture after runs
- manual memory tools (`mem0_store`, `mem0_forget`, `mem0_list`)

## When to use it / why it exists
- You want durable preference/decision memory across sessions.
- You want better recall than plain transcript history.
- You need explicit memory audit/list/delete tools.

## How it works (high-level)
- Initializes Mem0 OSS with configurable embedder/vector/LLM.
- `before_agent_start`: searches memories and injects `<mem0-recall>...</mem0-recall>` context.
- `agent_end`: extracts durable facts, skips noisy sessions/messages, stores memories, then deduplicates by similarity.
- Provides manual tools to store/list/delete memory entries.
- Adds resilience: SQLite fallback path, uncaught SQLite guard, transient embedding retries, env kill switch.

## Config reference
From `openclaw.plugin.json`:
- `userId` (string)
- `autoRecall` (boolean)
- `autoCapture` (boolean)
- `topK` (number)
- `searchThreshold` (number)
- `customInstructions` (string)
- `embedder` (object)
- `vectorStore` (object)
- `llm` (object)
- `historyDbPath` (string)

Used by code (not in manifest schema):
- `dedupThreshold` (number, default `0.92`)
- `captureLogPath` (string, default `/tmp/mem0-capture.log`)
- `minCaptureChars` (number, default `100`)

Environment variables:
- `MEM0_DISABLE` (`true`/`1` disables plugin)
- `MEM0_USER_ID` (overrides `userId`)
- `MEM0_HISTORY_DB_PATH` (fallback/override for history DB path)

## Typical tweaks
```json
{
  "mem0-sidecar": {
    "autoRecall": true,
    "autoCapture": true,
    "topK": 3,
    "searchThreshold": 0.3,
    "dedupThreshold": 0.92,
    "minCaptureChars": 100,
    "captureLogPath": "/tmp/mem0-capture.log"
  }
}
```

- Increase `topK` for more recall context.
- Raise `searchThreshold` to reduce weak matches.
- Raise `dedupThreshold` to keep more near-duplicates.

## Safe defaults / gotchas
- Captured memories can include sensitive operational details - control who can access memory tooling/logs.
- Heartbeat/noise sessions are intentionally skipped.
- On serious init failure, plugin disables itself instead of crashing gateway.

## Validation checklist
- Startup log confirms registration with recall/capture settings.
- Use `mem0_store` then `mem0_list` and verify stored item appears.
- Start session with relevant prompt and confirm `<mem0-recall>` injection in context.
- Confirm noisy heartbeat-like interactions are skipped in capture logs.
