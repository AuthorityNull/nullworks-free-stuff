# mem0-sidecar

Long-term semantic memory for OpenClaw agents via [Mem0 OSS](https://github.com/mem0ai/mem0). Auto-captures durable facts from conversations and injects relevant memories into new sessions.

## What it does

**Auto-recall** (`before_agent_start`): Searches the vector store for memories relevant to the incoming prompt and prepends them as `<mem0-recall>` context before the model runs.

**Auto-capture** (`agent_end`): Extracts durable facts from completed conversations using a quality-focused LLM extraction prompt. Skips noise (heartbeats, cron output, one-line acks). Runs deduplication - if a newly captured memory is >92% similar to an existing one, the duplicate is deleted.

**Manual tools**:
- `mem0_store` - Store a specific fact immediately
- `mem0_forget` - Delete a memory by ID
- `mem0_list` - Browse stored memories

Capture decisions are logged to an append-only file for auditing.

## Install

```bash
cd extensions/mem0-sidecar && npm install
```

Add to `openclaw.json`:

```json
{
  "plugins": {
    "mem0-sidecar": {
      "enabled": true,
      "userId": "my-agent",
      "autoRecall": true,
      "autoCapture": true,
      "topK": 3
    }
  }
}
```

## Config options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `userId` | string | `default` | Memory namespace. Use a unique ID per agent. Can also be set via `MEM0_USER_ID` env var |
| `autoRecall` | boolean | `true` | Inject relevant memories before each agent turn |
| `autoCapture` | boolean | `true` | Extract and store facts after each conversation |
| `topK` | number | `3` | Number of memories to inject per recall |
| `searchThreshold` | number | `0.3` | Minimum similarity score for recalled memories |
| `dedupThreshold` | number | `0.92` | Similarity threshold above which a new capture is considered a duplicate |
| `minCaptureChars` | number | `100` | Skip capture if conversation is shorter than this |
| `captureLogPath` | string | `/tmp/mem0-capture.log` | Append-only capture audit log |
| `historyDbPath` | string | `/tmp/mem0_history.sqlite` | SQLite history DB path. Can also be set via `MEM0_HISTORY_DB_PATH` env var |
| `embedder` | object | - | Custom Mem0 embedder config |
| `vectorStore` | object | - | Custom Mem0 vector store config |
| `llm` | object | - | Custom Mem0 LLM config for extraction |
| `customInstructions` | string | - | Override the built-in extraction prompt |

## Environment variables

| Variable | Description |
|----------|-------------|
| `MEM0_DISABLE=true` | Kill switch - disables the plugin entirely |
| `MEM0_USER_ID` | Override `userId` config |
| `MEM0_HISTORY_DB_PATH` | Override `historyDbPath` config |

## What gets captured

The extraction prompt instructs the LLM to capture:
- User preferences and communication style
- Decisions and their rationale
- Infrastructure state (IPs, ports, service configs)
- Lessons from debugging or failures
- Project milestones and status changes
- People (names, roles, relationships)
- Technical configurations

And to skip: status updates, transient tool operations, routine acks, resolved errors, automated flow noise.

## Notes

- Mem0 defaults to an in-process ChromaDB vector store and SQLite history. For production, configure an external vector store
- The plugin has a crash guard for SQLite errors and falls back to `/tmp` paths automatically
- Disable via `MEM0_DISABLE=true` for agents where memory persistence is not desired
