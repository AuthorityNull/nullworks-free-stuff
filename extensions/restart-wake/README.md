# Restart Wake (`restart-wake`)

## What it does
After a gateway restart, it wakes the relevant agent session automatically so work resumes without waiting for a new user message.

## When to use it / why it exists
- You rely on `gateway` restart flows during active tasks.
- You want restart context routed back into the originating session.
- You want to suppress default noisy restart sentinel behavior and replace it with actionable wake handling.

## How it works (high-level)
- Watches the OpenClaw state sentinel (`restart-sentinel.json`) and snapshots per-session sentinel files.
- On service start:
  - consumes built-in sentinel
  - reads all per-session sentinels from state and workspace-backed sentinel dirs
  - after `delayMs`, runs `agentCommand(..., deliver: true)` per sentinel with restart context message
- Starts a watcher to capture future sentinel writes during runtime.
- If wake for target session fails, optionally retries using fallback session key.

## Config reference
From `openclaw.plugin.json`:
- `enabled` (boolean, default `true`)
- `delayMs` (number, default `2500` in manifest; code base default is `3000` before pluginConfig merge)

Environment variables used:
- `OPENCLAW_STATE_DIR` (state dir override)
- `FALLBACK_SESSION_KEY` (fallback session for wake delivery)

Runtime paths used in code:
- state sentinel dir under `${OPENCLAW_STATE_DIR}` or `${HOME}/.openclaw`
- workspace sentinel dir: `/workspace/.restart-sentinels`

## Typical tweaks
```json
{
  "restart-wake": {
    "enabled": true,
    "delayMs": 2500
  }
}
```

- Increase `delayMs` if startup services (Discord login/hooks) are not ready in time.
- Set `FALLBACK_SESSION_KEY` when you want deterministic backup delivery target.

## Safe defaults / gotchas
- Only restart paths that write sentinel data are wakeable.
- Sentinel processing is best-effort; malformed files are deleted/ignored.
- `agentCommand` function discovery depends on OpenClaw dist module availability.
- Session wake processing is sequential.

## Validation checklist
- Trigger restart through gateway flow that writes sentinel.
- Confirm startup logs show sentinel consumption and number of session sentinels found.
- Confirm wake message/turn occurs in target session.
- If primary fails and fallback is set, confirm fallback attempt appears in logs.
