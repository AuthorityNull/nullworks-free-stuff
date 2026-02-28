# minion-lifecycle

Posts sub-agent and cron job lifecycle events to a Discord webhook. Tracks spawn, completion, failure, and real-time progress for all sub-agents spawned by your OpenClaw agent.

## What it does

- **Spawn notification**: Posts when a sub-agent is spawned via `sessions_spawn`
- **Completion notification**: Detects sub-agent/cron completion messages and posts status with emoji (✅ done, ❌ failed, ⏱️ timeout)
- **Progress tailing**: Polls `/workspace/tmp/minion-progress/<label>.log` every N seconds and posts new lines to Discord as they appear
- **Error mentions**: Optionally pings a Discord user on failure/timeout
- **Cleanup**: Deletes completed progress files automatically

Example messages posted to Discord:
```
🔄 Spawned: `write-extension-readmes` (claude-opus-4-6)
📡 Progress `write-extension-readmes`: Writing agent-coord README...
✅ Done: `write-extension-readmes` (subagent)
```

## Install

Copy the extension directory into your agent's extensions folder and add to `openclaw.json`:

```json
{
  "plugins": {
    "minion-lifecycle": {
      "enabled": true,
      "webhookUrl": "https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_TOKEN",
      "agentLabel": "clud",
      "progressPollMs": 15000,
      "errorMention": "<@YOUR_DISCORD_USER_ID>"
    }
  }
}
```

## Config options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable the plugin |
| `webhookUrl` | string | - | **Required.** Discord webhook URL |
| `agentLabel` | string | `clud` | Label used in log messages |
| `progressPollMs` | number | `15000` | How often to poll progress log files (ms) |
| `errorMention` | string | `""` | Discord mention string to ping on failure (e.g. `<@123456789>`) |

## Progress log integration

Sub-agents can write progress updates to `/workspace/tmp/minion-progress/<label>.log`. The plugin tails these files and posts each new line to Discord. The label should match the `sessions_spawn` label parameter.

```bash
# In a sub-agent script
mkdir -p /workspace/tmp/minion-progress
echo "Processing step 1 of 10..." >> /workspace/tmp/minion-progress/my-task.log
```

Progress files are cleaned up automatically when the sub-agent's completion event is detected.

## Notes

- Fire-and-forget webhook calls - never blocks the agent loop
- Line offsets are persisted to `.offsets.json` so progress survives the parent agent restarting mid-task
- The plugin guards against duplicate registration across multiple calls to `register()`
