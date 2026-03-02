# Safety Gate (`safety-gate`)

## What it does
Adds guardrails around restart/config operations and blocks direct dangerous container restart/stop commands.

## When to use it / why it exists
- You want to reduce cascading failures from rapid restart loops.
- You want safer restart semantics through gateway tooling (not direct docker restarts).
- You want restart intent preserved into the first post-restart turn.

## How it works (high-level)
- `gateway_start`: reads restart sentinel early and captures restart reason.
- `before_agent_start`: injects one-time restart recovery directive (`prependContext`) into first run after restart.
- `before_tool_call`:
  - Rate-limits `gateway` actions: `restart`, `config.apply`, `config.patch`.
  - Requires meaningful `reason` for `gateway config.apply`.
  - Blocks `nodes run` commands containing `docker restart/stop <protected agent>`.

## Config reference
From `openclaw.plugin.json`:
- `enabled` (boolean)
- `minRestartIntervalMs` (number, default `180000`)
- `protectedAgents` (string[], default `['clawdbot']`)

No extra runtime config keys beyond these.

Environment/path behavior:
- Restart sentinel path uses `OPENCLAW_STATE_DIR` or `${HOME}/.openclaw/restart-sentinel.json`.

## Typical tweaks
```json
{
  "safety-gate": {
    "enabled": true,
    "minRestartIntervalMs": 180000,
    "protectedAgents": ["clawdbot", "snoopy"]
  }
}
```

- Increase `minRestartIntervalMs` for stricter restart cooldown.
- Add critical containers to `protectedAgents`.

## Safe defaults / gotchas
- Direct Docker restart/stop is blocked only through inspected `nodes run` command arrays.
- Rate-limit state is in-memory (resets on process restart).
- Restart directive injection is one-time per captured sentinel reason.

## Validation checklist
- Call `gateway restart` twice quickly: second call should be blocked with cooldown reason.
- Call `gateway config.apply` without reason: should be blocked.
- Attempt `nodes run` with `docker restart <protectedAgent>`: should be blocked.
- After restart with sentinel reason, verify one-time recovery prepend is injected.
