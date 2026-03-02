# Tool Loop Breaker (`tool-loop-breaker`)

## What it does
Prevents runaway tool loops by enforcing per-turn checkpoints, warnings, and hard stops.

## When to use it / why it exists
- You want bounded autonomy in long tool-heavy turns.
- You want explicit progress checkpointing before context/tool overuse.
- You want automatic halt after repeated tool failures.

## How it works (high-level)
Per session key, it tracks:
- total tool calls
- consecutive tool errors
- whether checkpoint/warning/hard-block has fired

Hooks:
- `before_tool_call`:
  - increments call count
  - checkpoint block at `checkpointAtCalls` (one-time) instructing write to memory file
  - soft warning at `warnAtCalls`
  - hard block at `maxToolCalls`
  - hard block when consecutive errors reach `maxConsecutiveErrors`
- `after_tool_call`: updates consecutive error count
- `agent_end`: clears session counters

## Config reference
From `openclaw.plugin.json`:
- `enabled` (boolean)
- `maxConsecutiveErrors` (number, default `5`)
- `checkpointAtCalls` (number, default `30`)
- `warnAtCalls` (number, default `55`)
- `maxToolCalls` (number, default `69`)
- `checkpointMemoryPath` (string, default `/workspace/MEMORY.md`)

No extra runtime config keys beyond these.

## Typical tweaks
```json
{
  "tool-loop-breaker": {
    "enabled": true,
    "checkpointAtCalls": 30,
    "warnAtCalls": 55,
    "maxToolCalls": 69,
    "maxConsecutiveErrors": 5,
    "checkpointMemoryPath": "/workspace/MEMORY.md"
  }
}
```

- Lower thresholds for stricter control.
- Raise thresholds for complex workloads.
- Set `checkpointMemoryPath` to your preferred internal progress file.

## Safe defaults / gotchas
- Counters are per session and reset on `agent_end`.
- Hard block messages instruct user-facing summary; checkpoint block is internal-only.
- If session key is missing, fallback key is `unknown` (shared counter for such calls).

## Validation checklist
- Execute many tool calls in one turn and confirm checkpoint block triggers at configured threshold.
- Continue past warning threshold and verify warning logs.
- Hit max calls and confirm hard block.
- Force repeated tool errors and confirm consecutive-error block.
