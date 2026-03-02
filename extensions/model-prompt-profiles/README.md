# Model Prompt Profiles (`model-prompt-profiles`)

## What it does
Applies model-aware prompt/model routing rules per agent/session, including optional profile-based context prepend and optional system prompt override.

## When to use it / why it exists
- You run different models/providers for different workloads.
- You need deterministic routing by prompt/session/model regex.
- You want profile-driven prompt trees without hardcoding per-run logic.

## How it works (high-level)
- `before_model_resolve`: applies provider/model overrides from matching rule/profile.
- `before_prompt_build`: injects `prependContext`, and optionally `systemPrompt`.
- Rules match against prompt text, session key, and model text.
- Optional prompt-tree loading reads profile files from allowed base directories.
- Instance/agent gating prevents applying rules in the wrong runtime.

## Config reference
From `openclaw.plugin.json`:
- `enabled` (boolean)
- `instanceId` (string)
- `strictInstanceMatch` (boolean)
- `allowedAgentIds` (string[])
- `maxPrependChars` (number)
- `maxSystemPromptChars` (number)
- `allowSystemPromptOverride` (boolean)
- `promptTreeBaseDirs` (string[])
- `profiles` (object)
  - `prependContext` (string)
  - `systemPrompt` (string)
  - `providerOverride` (string)
  - `modelOverride` (string)
  - `promptTreeDir` (string)
  - `promptFiles` (string[])
  - `promptJoiner` (string)
- `rules` (array)
  - `profile` (string)
  - `promptRegex` (string)
  - `sessionKeyRegex` (string)
  - `modelRegex` (string)
  - `providerOverride` (string)
  - `modelOverride` (string)
- `defaultPromptFilesMain` (string[])
- `defaultPromptFilesSubagent` (string[])
- `defaultPromptJoinerMain` (string)
- `defaultPromptJoinerSubagent` (string)

Environment variables used for instance detection:
- `OPENCLAW_INSTANCE_ID`, `INSTANCE_ID`
- `OPENCLAW_AGENT_ID`, `AGENT_ID`
- `OPENCLAW_AGENT_NAME`, `AGENT_NAME`
- `HOSTNAME`

## Typical tweaks
```json
{
  "model-prompt-profiles": {
    "enabled": true,
    "allowedAgentIds": ["main"],
    "allowSystemPromptOverride": false,
    "rules": [
      {
        "profile": "coding",
        "modelRegex": "gpt|claude"
      }
    ],
    "profiles": {
      "coding": {
        "prependContext": "Follow repo coding standards.",
        "modelOverride": "cliproxy/gpt-5.3-codex"
      }
    }
  }
}
```

- Keep `allowSystemPromptOverride=false` unless you explicitly need full override.
- Use `promptTreeBaseDirs` to restrict prompt-file read scope.

## Safe defaults / gotchas
- Invalid regex entries are skipped with warnings.
- If `strictInstanceMatch=true` and instance check fails, plugin is inactive.
- Prompt text is truncated by `maxPrependChars` / `maxSystemPromptChars`.
- Prompt tree path escaping is blocked; files must resolve under allowed base dirs.

## Validation checklist
- Startup log prints active instance and allowed agents.
- Trigger a matching rule and confirm override log in `before_model_resolve`.
- Confirm `prependContext` appears when expected.
- If using prompt trees, verify file load logs and path restrictions.
