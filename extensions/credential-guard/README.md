# Credential Guard (`credential-guard`)

## What it does
Redacts credential-like secrets from messages and tool outputs, and blocks risky command execution containing secret patterns.

## When to use it / why it exists
- You use tools that may expose API keys/tokens in transcripts.
- You want a defense layer before content is persisted to session context.

## How it works (high-level)
Hooks:
- `before_tool_call`: 
  - Redacts `message` tool sends (`action=send`).
  - Blocks `exec` / `nodes` commands if command text matches credential patterns.
- `before_message_write`: redacts assistant message content before write.
- `tool_result_persist`: redacts tool result content before persistence.

Patterns include JWT, OpenAI/Anthropic/OpenRouter/GitHub/Discord tokens, private keys, bearer tokens, connection strings, etc.

## Config reference
From `openclaw.plugin.json`:
- `enabled` (boolean)

No additional plugin config keys are read in code.

## Typical tweaks
```json
{
  "credential-guard": {
    "enabled": true
  }
}
```

If false positives appear, adjust code patterns (no runtime config exists for custom patterns).

## Safe defaults / gotchas
- It uses regex heuristics; false positives/negatives are possible.
- `exec`/`nodes` blocking only checks string command payloads.
- Redaction format preserves first 4 characters then masks with `***[REDACTED]`.

## Validation checklist
- Trigger a tool output containing test token text and confirm persisted output is redacted.
- Try `message` tool send with test secret string and confirm redacted send params.
- Try `exec` with credential-like text and confirm tool call is blocked with reason.
