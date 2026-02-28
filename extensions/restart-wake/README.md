# restart-wake

Auto-wakes agents after a gateway restart by replaying their active session. Ensures agents resume in-progress work immediately after a `gateway({ action: "restart" })` without manual intervention.

## What it does

**At startup** (service `start`):
1. Consumes the built-in restart sentinel to suppress the default noisy restart message
2. Reads per-session sentinel files written before the restart
3. For each session, waits `delayMs` then calls `agentCommand` to run a full agent turn with a `[System Message]` containing the restart reason and a directive to resume work
4. Falls back to the owner DM session if the original session key fails to route

**At runtime** (fs.watch):
Watches for new `restart-sentinel.json` writes and copies them to per-session files under `~/.openclaw/restart-sentinels/`. This captures the session key before the process restarts.

Sentinels are also written to `/workspace/.restart-sentinels/` (a volume-mounted path) so they survive container recreates.

## Install

Copy the extension directory into your agent's extensions folder and add to `openclaw.json`:

```json
{
  "plugins": {
    "restart-wake": {
      "enabled": true,
      "delayMs": 3000
    }
  }
}
```

## Config options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable the plugin |
| `delayMs` | number | `3000` | Milliseconds to wait after gateway startup before running agent turns. Needs to be long enough for Discord login and hook registration |

## Environment variables

| Variable | Description |
|----------|-------------|
| `OPENCLAW_STATE_DIR` | Override state directory (default: `~/.openclaw`) |
| `FALLBACK_SESSION_KEY` | Session to use if primary session routing fails (default: `agent:main:discord:direct:owner`) |

## How the restart flow works

```
gateway({ action: "restart" })
  → writes restart-sentinel.json (includes sessionKey, note, reason)
  → SIGUSR1 → process exits
  → process restarts → restart-wake plugin starts
  → consumeBuiltinSentinel() suppresses default restart message
  → consumeSessionSentinels() reads per-session files
  → setTimeout(delayMs) waits for full gateway init
  → agentCommand({ sessionKey, message: "[System Message] ...resume..." })
  → agent wakes in the correct session and resumes work
```

## Notes

- **Only fires on sentinel restarts.** A fresh `docker compose up` produces no sentinel - the plugin skips wake. This is intentional.
- Raw `kill -USR1 1` does not write a sentinel. Only the gateway tool restart does.
- After editing this extension, `docker compose down && up` is required (SIGUSR1 does not reload CJS modules)
- If `agentCommand` or `createDefaultDeps` are not found in the OpenClaw dist, the plugin logs a warning and skips wake
