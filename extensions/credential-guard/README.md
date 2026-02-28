# credential-guard

Three-layer credential redaction for OpenClaw agents. Prevents API keys, tokens, and secrets from leaking into Discord messages, session transcripts, or tool result context.

## What it does

Registers three hooks that scan for and redact credential patterns:

1. **`before_tool_call`** - Intercepts outbound messages and blocks `exec`/`nodes` commands that contain credential patterns
2. **`before_message_write`** - Redacts assistant messages before they are written to the session transcript
3. **`tool_result_persist`** - Redacts tool results before they enter the model's context window

Detected patterns:

| Type | Pattern |
|------|---------|
| JWT | `eyJ...` (3-part dot-separated) |
| OpenAI | `sk-...` |
| Anthropic | `sk-ant-...` |
| OpenRouter | `sk-or-...` |
| Google API | `AIza...` |
| GitHub PAT | `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` |
| Discord Token | Bot token pattern |
| PostHog | `phx_`, `phc_`, `php_` |
| Groq | `gsk_...` |
| ElevenLabs | `el_...` |
| AWS Access Key | `AKIA...` |
| HashiCorp Vault | `hvs....` |
| Bearer tokens | `Bearer <token>` |
| Private keys | PEM blocks |
| Connection strings | `://user:pass@host` |

Redacted values are replaced with `<first4chars>***[REDACTED]`.

## Install

Copy the extension directory into your agent's extensions folder and add to `openclaw.json`:

```json
{
  "plugins": {
    "credential-guard": {
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

## Behavior on detection

- **Messages/transcripts**: credential is redacted in-place, message content is modified before storage
- **Tool commands** (`exec`/`nodes`): the entire tool call is **blocked** with an error message telling the agent to use secret-handling scripts instead
- All redaction events are logged with a running count

## Notes

- This is a defense-in-depth measure. Primary secret management should still use a vault or environment variables
- The `exec`/`nodes` block is intentionally strict - commands with embedded credentials should never run
- Redaction is applied to both string content and structured content block arrays
