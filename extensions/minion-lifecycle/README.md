# Minion Lifecycle (`minion-lifecycle`)

## What it does
Posts sub-agent lifecycle events (spawn, progress, completion) to a Discord webhook.

## When to use it / why it exists
- You delegate work to sub-agents and want operational visibility.
- You want push-style progress updates in a Discord channel.

## How it works (high-level)
- Watches lifecycle hooks:
  - `subagent_spawned`
  - `subagent_ended`
- Polls `/workspace/tmp/minion-progress/*.log` for new lines and posts incremental progress.
- Uses fallback detection paths (`after_tool_call` for `sessions_spawn`, and system-message parsing) when authoritative hooks are unavailable.
- Persists offsets/run metadata in:
  - `/workspace/tmp/minion-progress/.offsets.json`
  - `/workspace/tmp/minion-progress/.runs.json`
- Retries webhook posts with exponential backoff + jitter.

## Config reference
From `openclaw.plugin.json`:
- `enabled` (boolean)
- `webhookUrl` (string)
- `agentLabel` (string)
- `progressPollMs` (number, default `15000`)
- `errorMention` (string)
- `retryMax` (number, default `5`)
- `retryBaseMs` (number, default `1500`)
- `retryJitterMs` (number, default `400`)

No extra runtime config keys beyond these.

## Typical tweaks
```json
{
  "minion-lifecycle": {
    "enabled": true,
    "webhookUrl": "https://discord.com/api/webhooks/...",
    "agentLabel": "clud",
    "progressPollMs": 15000,
    "retryMax": 5,
    "retryBaseMs": 1500,
    "retryJitterMs": 400
  }
}
```

- Lower `progressPollMs` for faster updates.
- Set `errorMention` to ping owner on failed/timeout outcomes.

## Safe defaults / gotchas
- If `webhookUrl` is missing, plugin stays inactive.
- Progress polling is best-effort and file-based; deleted/missing files are tolerated.
- Dedupe window suppresses repeated identical lifecycle posts.

## Validation checklist
- Spawn a sub-agent: confirm a `Spawned` webhook post appears.
- Append lines to matching progress log: confirm progress posts appear.
- End sub-agent with success/failure: confirm completion post and progress file cleanup.
