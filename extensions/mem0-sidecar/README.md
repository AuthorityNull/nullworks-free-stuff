# Mem0 Sidecar (`mem0-sidecar`)

## What it does
Adds Mem0-based long-term memory alongside OpenClaw's built-in memory flow, with:
- auto-recall before agent runs
- auto-capture after runs
- manual memory tools (`mem0_store`, `mem0_forget`, `mem0_list`)

## When to use it / why it exists
- You want durable preference and decision memory across sessions.
- You want better recall than plain transcript history.
- You need explicit memory audit, list, and delete tools.

## How it works (high-level)
- Initializes Mem0 OSS with configurable embedder, vector store, and LLM backends.
- `before_agent_start`: searches memories and injects `<mem0-recall>...</mem0-recall>` context.
- `agent_end`: extracts durable facts, skips noisy sessions/messages, stores memories, then deduplicates by similarity.
- Provides manual tools to store, list, and delete memory entries.
- Adds resilience around local history state and transient backend failures.

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

Common runtime options:
- `dedupThreshold` (number, default `0.92`)
- `captureLogPath` (string, optional)
- `minCaptureChars` (number, default `100`)

Environment variables:
- `MEM0_DISABLE` (`true`/`1` disables plugin)
- `MEM0_USER_ID` (overrides `userId`)
- `MEM0_HISTORY_DB_PATH` (fallback or override for history DB path)

## Typical config
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

## Safe defaults / gotchas
- Captured memories can include sensitive operational details. Control who can access memory tooling and logs.
- Heartbeat and other low-signal sessions should usually be skipped from capture.
- On serious init failure, the plugin should disable itself instead of crashing the gateway.
- Keep credentials out of committed config. Use environment variables or your secret manager for provider auth.

## Validation checklist
- Startup logs confirm registration with recall and capture settings.
- Use `mem0_store`, then `mem0_list`, and verify the stored item appears.
- Start a session with a relevant prompt and confirm `<mem0-recall>` context is injected.
- Confirm noisy heartbeat-like interactions are skipped in capture logs.

## Status
This public page restores the extension docs and link target without publishing any credentials or deployment-specific secrets.
