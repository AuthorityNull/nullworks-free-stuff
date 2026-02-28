# restart-wake extension (v4)

Auto-wakes agents after a gateway tool restart (`gateway({ action: "restart" })`).

## What it does

1. **Consumes the restart sentinel** before the built-in handler - suppresses the noisy outbound "Gateway restart" message in Discord
2. **Runs a full agent turn** via `agentCommand` (same mechanism as boot-md) in the session that triggered the restart
3. Injects the restart note/reason as a `[System Message]` so the agent has context to resume work

## How it works

```
gateway tool restart
  → writeRestartSentinel (includes sessionKey, note, reason)
  → SIGUSR1 → process restarts
  → restart-wake plugin starts
  → consumeSentinel() reads + deletes sentinel file (before built-in 750ms consumer)
  → setTimeout(delayMs) waits for gateway to fully initialize
  → agentCommand({ message, sessionKey, deliver: true }) runs a full agent turn
  → agent auto-wakes in the correct session with restart context
```

## Key behaviors

- **Only fires on sentinel restarts** - fresh container starts (`docker compose up`) produce no sentinel, so the extension skips wake. This is intentional: fresh starts should follow normal boot-md flow.
- **Session-aware** - the sentinel captures which session triggered the restart (DM, channel, etc.) and the wake targets that exact session.
- **Uses `agentCommand` from pi-embedded** - this is the same function boot-md uses. It runs a real agent turn with tool access, not just a system event queue injection.

## Config

In `openclaw.json` under `plugins.config`:

```json
"restart-wake": {
  "enabled": true,
  "delayMs": 3000
}
```

- `enabled` - toggle the extension (default: `true`)
- `delayMs` - milliseconds to wait after startup before running the agent turn (default: `3000`). Needs to be long enough for Discord login, hooks, etc.

## Deployment

Shared extension mounted into agent containers via docker-compose volume. Place in your extensions directory.

Both Clud and Snoopy have a copy at `config/extensions/restart-wake/`.

## Why not enqueueSystemEvent / requestHeartbeatNow?

These were tried in v1-v3 and failed:

| Approach | Problem |
|----------|---------|
| `requestHeartbeatNow` (v1) | Heartbeat runs in its own session, doesn't trigger the DM/channel session |
| `enqueueSystemEvent` (v2) | Queues the event but nothing drains the queue until the next inbound message |
| Both combined (v3) | Same issue - heartbeat session ≠ DM session, queue sits undrained |
| `agentCommand` (v4) ✅ | Runs a full agent turn in the target session, processes tools, delivers response |

## Gotchas

- **SIGUSR1 doesn't reload CJS modules** - after editing the extension, you need `docker compose down && up` (not just restart) to load new code
- **Raw `kill -USR1 1`** doesn't write a sentinel - only the gateway tool restart does. Raw SIGUSR1 = "fresh start" from the extension's perspective
- The built-in sentinel consumer runs at ~750ms. Our extension consumes at startup (~0ms), winning the race
