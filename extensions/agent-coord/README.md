# agent-coord

Multi-agent channel coordination for OpenClaw. Prevents multiple agents from responding to the same message in shared Discord channels using a layered routing system backed by Redis.

## What it does

Routes incoming messages to the correct agent in shared channels. Three decision layers run in order:

1. **Gate** - Deterministic rules (<1ms): direct @mentions, reply-to routing, sibling filtering, Redis channel ownership bias
2. **Classify** - Intent-based routing (~200ms): keyword fast-path first, then optional local LLM fallback (Ollama) for ambiguous messages
3. **Race lock** - Redis NX tiebreak for truly open messages when no agent has a clear claim

Side behaviors:
- **Ack-react**: acknowledgment messages ("thanks", "lgtm", "ok") get an emoji reaction instead of a full agent response, saving compute
- **Cross-session driving lock**: prevents multiple sessions of the same agent from responding concurrently
- **skipReply**: denied agents return `{ skipReply: true }` from `before_agent_start` - the model never runs, zero wasted tokens

## Install

Copy the extension directory into your agent's extensions folder and add to `openclaw.json`:

```json
{
  "plugins": {
    "agent-coord": {
      "enabled": true,
      "redisUrl": "redis://localhost:6379",
      "agentId": "clud",
      "discordUserId": "YOUR_AGENT_DISCORD_USER_ID",
      "ownerTtl": 300
    }
  }
}
```

Set the shared channels via environment variable:

```bash
AGENT_COORD_SHARED_CHANNELS=1234567890,9876543210
```

## Config options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `false` | Enable the plugin |
| `redisUrl` | string | `redis://localhost:6379` | Redis connection URL |
| `keyPrefix` | string | `agent-coord:` | Redis key prefix |
| `agentId` | string | - | Agent identifier (e.g. `clud`) |
| `discordUserId` | string | - | This agent's Discord user ID - used to identify the agent in the routing table |
| `ownerTtl` | number | `300` | Channel ownership TTL in seconds |
| `classify.enabled` | boolean | `true` | Enable intent classification layer |
| `classify.keywordOnly` | boolean | `false` | Skip LLM, use keyword matching only |
| `classify.llm.url` | string | - | Ollama base URL (e.g. `http://localhost:11434`) |
| `classify.llm.model` | string | - | Model for classification (e.g. `qwen2.5:3b`) |
| `classify.llm.timeoutMs` | number | `3000` | LLM classification timeout |

## Example

With two agents (Clud and Snoopy) sharing a channel:

- User: `@Snoopy fix the login bug` - Snoopy handles it, Clud's `before_agent_start` returns `{ skipReply: true }`
- User: `can you review this PR?` - keyword classifier routes to `clud` (code review)
- User: `thanks!` - one agent reacts with 👍, neither responds with text
- User: `implement the auth service` - keyword classifier routes to `snoopy` (implementation)

## Notes

- Redis is required. If Redis is unavailable, the plugin fails open (all agents can respond)
- `DISCORD_BOT_TOKEN` env var must be set for reply-chain resolution via Discord API
- Designed for Discord but the hook interface is channel-agnostic
