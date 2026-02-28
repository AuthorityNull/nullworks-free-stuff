# safety-gate

Enforces safety checks on high-risk operations. Rate-limits gateway restarts, requires reasons for config changes, blocks direct docker container manipulation, and injects a restart recovery directive after reboots.

## What it does

**`before_tool_call` checks:**

- **Restart rate-limiting**: Blocks `gateway({ action: "restart" })` calls within `minRestartIntervalMs` of the last restart. Prevents cascading restart loops.
- **Config change reason requirement**: Blocks `gateway({ action: "config.apply" })` unless a meaningful `reason` parameter is provided (min 5 characters).
- **Docker protection**: Blocks `nodes run` commands containing `docker restart <agent>` or `docker stop <agent>`. Forces use of the gateway restart tool instead, which ensures the session wakes up properly.

**`gateway_start` + `before_agent_start`:**

Reads the restart sentinel on startup and injects a directive into the first agent turn:
```
[RESTART RECOVERY - ACTION REQUIRED]
You just restarted. Your restart note said:
"<restart note>"

Execute the plan described above immediately...
```

This ensures the agent acts on restart notes rather than just acknowledging them.

## Install

Copy the extension directory into your agent's extensions folder and add to `openclaw.json`:

```json
{
  "plugins": {
    "safety-gate": {
      "enabled": true,
      "minRestartIntervalMs": 180000,
      "protectedAgents": ["clawdbot", "snoopy"]
    }
  }
}
```

## Config options

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable the plugin |
| `minRestartIntervalMs` | number | `180000` (3 min) | Minimum time between allowed restarts |
| `protectedAgents` | string[] | `["clawdbot"]` | Container names that cannot be directly docker-restarted |

## Example blocks

**Restart too soon:**
```
[safety-gate] Restart rate limit: last restart was 45s ago. Wait 135s.
This prevents cascading failures from rapid restarts.
```

**Config apply without reason:**
```
[safety-gate] config.apply requires a meaningful reason parameter explaining
what changed. This is logged and helps with debugging if the restart fails.
```

**Direct docker stop:**
```
[safety-gate] Direct docker restart/stop of clawdbot is blocked.
Use gateway({ action: "restart" }) instead.
```

## Notes

- The restart directive injection fires only once per gateway start (consumed on first `before_agent_start`)
- Stats (blocked/allowed counts) are tracked in memory and visible in logs
- The plugin reads the sentinel file at `gateway_start` time, before OpenClaw's own sentinel consumer
