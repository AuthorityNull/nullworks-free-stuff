# promise-keeper

Detects when an agent makes a promise without backing it up and nudges it to take concrete action. Guards against two failure modes: time-based promises without a scheduled cron, and declarative fix promises without a disk write.

## What it does

After each agent turn (`agent_end`), scans the last assistant message for two types of unfulfilled promises:

**Time promises** - phrases like "I'll check later", "I'll report back", "waiting for X" - require a `cron` tool call in the same turn. If none was made, the agent receives a system nudge:
> `[promise-keeper] You told the user you would do something later (detected: "I'll check later") but did NOT schedule any cron...`

**Fix promises** - phrases like "won't happen again", "going forward", "noted for next time" - require a `write`, `edit`, or `exec` tool call in the same turn. If nothing was written to disk, the agent receives a blunter nudge:
> `[promise-keeper] NO YOU WONT. TAKE SURGICAL ACTION NOW. You said "going forward" but wrote NOTHING to disk...`

Nudges are sent via `agentCommand` (injected into the active session) with a 5-minute cooldown per session.

## Install

Copy the extension directory into your agent's extensions folder and add to `openclaw.json`:

```json
{
  "plugins": {
    "promise-keeper": {
      "enabled": true
    }
  }
}
```

No additional configuration required.

## Config options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable the plugin |

## Detected promise patterns

**Time promises** (require cron scheduling):
- `I'll check / I'll monitor / I'll come back`
- `waiting for / wait until`
- `as soon as`
- `when it opens / once it's ready`
- `I'll ping / I'll let you know / I'll report back`

**Fix promises** (require disk write):
- `won't happen again`
- `going forward`
- `noted for next time`
- `I'll remember this`
- `never again / learned my lesson`
- `fixed for good`

## Notes

- `HEARTBEAT_OK` and `NO_REPLY` responses are always skipped
- False positives ("was waiting", "while waiting") are filtered out
- The plugin pre-warms its function cache on startup to minimize latency on the first nudge
- Requires `agentCommand` from the OpenClaw `pi-embedded` module to deliver nudges
