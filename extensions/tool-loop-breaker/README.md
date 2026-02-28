# tool-loop-breaker

Circuit breaker for runaway agent tool loops. Tracks tool call counts and consecutive errors per session, blocking further calls and forcing the agent to respond to the user when thresholds are exceeded.

## What it does

Registers three hooks:

**`before_tool_call`** - Enforces two limits per session:
- **Total call limit** (hard block at `maxToolCalls`): Blocks all further tool calls and injects a message forcing an immediate user response
- **Soft warning** (at `warnAtCalls`): Logs a warning without blocking - gives the agent a chance to wrap up
- **Consecutive error limit** (at `maxConsecutiveErrors`): Blocks further calls if the last N tool calls all errored

**`after_tool_call`** - Tracks consecutive errors. Resets the counter on any successful tool call.

**`agent_end`** - Cleans up the session counter when the agent turn completes.

Counters are keyed per `sessionKey`, so parallel sessions don't interfere with each other.

## Install

Copy the extension directory into your agent's extensions folder and add to `openclaw.json`:

```json
{
  "plugins": {
    "tool-loop-breaker": {
      "enabled": true,
      "maxToolCalls": 30,
      "warnAtCalls": 25,
      "maxConsecutiveErrors": 5
    }
  }
}
```

## Config options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable the plugin |
| `maxToolCalls` | number | `30` | Hard block after this many total tool calls in one agent turn |
| `warnAtCalls` | number | `25` | Log warning (no block) when this many calls are reached |
| `maxConsecutiveErrors` | number | `5` | Hard block after this many consecutive tool errors |

## Block messages

When the hard limit is hit, the tool call is blocked with an explicit message embedded in the block reason:

```
STOP. You have made 30 tool calls in one turn (limit: 30). You MUST stop all
tool calls immediately and deliver your current findings to the user.
This is not optional. Respond now.
```

For consecutive errors:
```
STOP. 5 consecutive tool errors detected. Something is broken. You MUST stop
making tool calls and tell the user what went wrong. Respond now.
```

## Notes

- Once the circuit breaker trips (`counter.blocked = true`), all subsequent tool calls in that session are blocked until `agent_end` resets the state
- The `warnAt` threshold produces a log entry only - the model is not directly informed of the warning unless the tool result system surfaces it
- Counters are in-memory only and reset on gateway restart
