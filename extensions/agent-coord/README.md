# Agent Coordination (`agent-coord`)

## What it does
Coordinates multiple agents in shared channels so only the right agent responds.

## When to use it / why it exists
- You run multiple agents in the same Discord channels.
- You want to avoid duplicate replies and reply races.
- You want channel "ownership" so follow-ups stay consistent.

## How it works (high-level)
- `message_received`: stores message context and may add lightweight reactions.
- `before_agent_start`: computes allow/deny routing decision.
- `message_sending`: safety-net cancel if decision says skip.
- Ownership and race coordination are stored in Redis with TTL.
- Ambiguous messages can use keyword classification (`decide.js`) and optional LLM fallback (`config.classify`).

## Config reference
From `openclaw.plugin.json`:
- `enabled` (boolean)
- `redisUrl` (string)
- `keyPrefix` (string)
- `agentId` (string)
- `discordUserId` (string)
- `agentNames` (string[])
- `ownerTtl` (number)

Used by code (not declared in manifest schema):
- `discordTokenEnv` (string, default `DISCORD_BOT_TOKEN`)
- `classify.enabled` (boolean)
- `classify.keywordOnly` (boolean)
- `classify.llm.url` (string)
- `classify.llm.model` (string)
- `classify.llm.timeoutMs` (number)

Environment variables:
- `AGENT_COORD_SHARED_CHANNELS` (comma-separated channel IDs)
- `REDIS_URL` (overrides `redisUrl`)
- `DISCORD_BOT_TOKEN` (or env named by `discordTokenEnv`)
- `DISCORD_BOT_CLUD`, `DISCORD_BOT_SNOOPY`, `DISCORD_BOT_ECHO`

## Typical tweaks
```json
{
  "agent-coord": {
    "enabled": true,
    "redisUrl": "redis://redis:6379",
    "keyPrefix": "agent-coord:",
    "ownerTtl": 300,
    "discordUserId": "<discord-user-id>"
  }
}
```

- Lower `ownerTtl` for faster handoff.
- Raise `ownerTtl` for stronger channel stickiness.
- Add `classify` config if you want LLM tie-breaking.

## Safe defaults / gotchas
- If `discordUserId` is invalid, routing cannot identify this agent.
- Redis failures are mostly fail-open to avoid total silence.
- Coordination only runs in channels listed by `AGENT_COORD_SHARED_CHANNELS`.

## Validation checklist
- Startup logs show hooks registered.
- Mention a specific agent in shared channel: only that agent should answer.
- Send ambiguous prompt: owner/race/classifier reason appears in logs.
- Verify Redis owner keys update with TTL.
