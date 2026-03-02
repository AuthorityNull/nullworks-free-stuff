# Promise Keeper (`promise-keeper`)

## What it does
Detects unfulfilled assistant promises at end-of-turn and injects a corrective system nudge into the same session.

## When to use it / why it exists
- You want to prevent "I'll do X later" without scheduling follow-through.
- You want fewer empty "won't happen again" claims without concrete fixes.
- You want continuation honesty when turns end after heavy tool usage.

## How it works (high-level)
On `agent_end` (successful turns):
- Skips internal/heartbeat/system lanes.
- Reads last assistant text and detects:
  1) **Time promises** ("I'll check later") -> expects `cron` scheduling.
  2) **Fix promises** ("won't happen again") -> expects write action (`write`/`edit`/`exec`).
  3) **Continuation promises** ("continuing now") after many tool calls -> expects either real continuation or honest user update.
- If broken, sends internal nudge via embedded `agentCommand` into same session.
- Uses cooldown to avoid repeated nagging.

## Config reference
From `openclaw.plugin.json`:
- `enabled` (boolean)

No additional plugin config keys are used by code.

## Typical tweaks
```json
{
  "promise-keeper": {
    "enabled": true
  }
}
```

Behavior tuning (patterns/thresholds/cooldowns) currently requires code edits.

## Safe defaults / gotchas
- Pattern-based detection can misclassify edge phrasing.
- Relies on `agentCommand` discovery from OpenClaw dist modules; if unavailable, nudges cannot be delivered.
- Intentionally ignores internal lanes and push-coordination turns.

## Validation checklist
- End a turn with "I'll check later" and no cron: verify warning + nudge log.
- End a turn with fix promise and no write/edit/exec: verify fix nudge.
- End a heavy tool turn with "continuing now": verify continuation nudge.
- Confirm no nudge when cron or concrete fix action exists.
