# Agent Coordination v3 - Design Spec

## Problem Statement
v2.1 is a blind gatekeeper. It decides WHO CAN respond, not WHO SHOULD. Result:
- Wrong agent responds to technical questions (Clud answers when Snoopy should)
- No collaboration path (agents cannot chime in with relevant context)
- Token waste: denied agents still run full inference before output is dropped
- Blind during tool loops: agents cannot see new messages mid-turn

## Architecture - Three Layers

```
Layer 1: GATE (v2 logic, <1ms, zero cost)
  | pass
Layer 2: CLASSIFY (intent routing, ~200ms, local LLM)
  | routed
Layer 3: COLLABORATE (chime-in + awareness, async)
```

### Layer 1: Gate (existing v2.1 logic)
No changes. Fast deterministic rules handle:
- DMs/non-shared -> always allow
- @mention/reply-to -> route to target
- Sibling filter -> deny non-targeted agent messages
- Owner bias -> route to current owner
- Cross-session driving lock -> defer to remote session
- Open race -> Redis NX tiebreak

If Gate produces a definitive answer (priority >= 50), skip Layer 2.

### Layer 2: Classify (NEW - intent-based routing)
Triggers ONLY when Gate returns `open-race` (no owner, no mention, no reply-to).

**Two-tier classification:**

1. **Keyword fast-path** (~0ms, zero cost): Pattern matching for obvious cases
   - Code/config/debug keywords -> snoopy
   - Deploy/restart/infra/architecture -> clud
   - Greetings/casual -> current owner or race
   - Handles ~60% of messages without any LLM call

2. **Local LLM fallback** (~200-400ms, zero $ cost): Ollama qwen2.5:3b
   - Only for ambiguous messages keyword matching cant route
   - Single-shot classification, max 50 output tokens
   - 3s timeout, fail-open to race on timeout

**Agent Profiles (used by LLM classifier):**
- clud: coordinator - architecture, planning, orchestration, code review, infra, config
- snoopy: engineer - implementation, coding, refactoring, testing, debugging, research
- echo: public-facing - community, explanations, user support, creative

**Caching:** 60s per-channel. Sequential messages usually target same agent.

### Layer 3: Collaborate (NEW - async chime-in)
After primary agent responds, non-primary agents get a chime opportunity:

1. Primary agent responds (normal flow)
2. On message_sent, publish to Redis: `agent-coord:chime:{channelId}`
3. Other agents evaluate: "Do I have something to ADD?" (local LLM, ~50 tokens)
4. If yes -> brief follow-up. If no -> silent (zero tokens)

**Chime rules:**
- Never chime on casual/greeting messages
- Only when adding NEW information (not repeating primary)
- Max 1 chime per agent per message
- 5-30s staggered delay after primary response
- Configurable per-channel (can disable)

### Mid-Turn Awareness (Layer 3 enhancement)

**Problem:** Agent blind during tool loops. Two agents edit same file = conflict.

**Solution: "Working-on" Redis locks**
```
Key: agent-coord:working:{channelId}:{agentId}
Value: { task: "editing scripts/foo.js", since: timestamp }
TTL: 300s (refreshed each tool call)
```

- Agent sets `working` key when starting tool-heavy turn
- Other agents check `working` keys in message_received
- If conflict detected -> inject context note: "{agent} is working on: {task}"
- Agent decides: wait, coordinate, or work on non-conflicting task

## Phased Rollout

### Phase 1: Intent Classification (highest value, ship first)
- Keyword fast-path in decide.js
- LLM classification fallback
- Wire into handleMessageReceived between Gate and race lock
- **Effort:** ~2h. **Impact:** Right agent responds 80%+ of the time.

### Phase 2: Working-On Locks
- Redis lock set/check in hooks
- Context injection for mid-turn awareness
- **Effort:** ~1h. **Impact:** Prevents conflicting concurrent work.

### Phase 3: Chime-In
- Redis pub/sub for chime notifications
- LLM-based chime evaluation
- Throttling and rules
- **Effort:** ~3h. **Impact:** Natural multi-agent collaboration.

## Config Additions

```json
{
  "classify": {
    "enabled": true,
    "keywordOnly": false,
    "llm": {
      "url": "http://localhost:11434",
      "model": "qwen2.5:3b",
      "timeoutMs": 3000
    },
    "cacheTtlMs": 60000
  },
  "chime": {
    "enabled": false,
    "windowMs": 30000,
    "delayMs": 5000,
    "disabledChannels": []
  },
  "workingLocks": {
    "enabled": true,
    "ttlMs": 300000
  }
}
```

## Migration
- Backward-compatible with v2.1 config
- New keys have sensible defaults (classify on, chime off)
- decide.js gets classifyIntent() alongside decideRouting()
- Phase 1 ships independently, no dependency on Phase 2/3

## Shipped Features (as of v3.0 - 2026-02-26)

### Phase 1: Intent Classification ✅
- Keyword classifier in `decide.js` (pattern-match to agent profiles)
- LLM fallback via Ollama qwen2.5:3b (3s timeout, fail-open)
- 60s per-channel classification cache
- Classification runs on human messages with priority < 90 (owner-bias + open-race)
- Bug fix: `shouldClassify` now covers `owned-by:*` paths, not just `open-race`
- Bug fix: Decisions keyed by messageId (not channelId) with 30s TTL - all sessions see same decision

### Ack-React (v3.0+) ✅
Acknowledgment messages get an emoji reaction instead of a full agent response.
- **ACK_PHRASES** (safe in multi-word msgs): thanks, thank you, thx, appreciate it, no worries, sounds good, lgtm
- **ACK_STANDALONE** (full-message only): ok, okay, k, ty, got it, nice, cool, great, perfect, awesome, np, bet, aight, word, dope, fire, emojis
- Max message length: 80 chars
- Race-locked via Redis (only one agent reacts)
- Fallback: Clud reacts if Redis unavailable
- Fires BEFORE routing - even reply-to-agent ack messages get reaction-only treatment

### PATCH26: skipReply ✅
- `before_agent_start` returns `{ skipReply: true }` for DENY decisions
- Kills model call before it starts - zero wasted compute on denied agents

### Cross-Session Driving Lock (v2.1) ✅
- `message_sending` sets Redis `driving:<agent>:<channel>` key (120s TTL)
- Channel's own session defers when remote session is driving

### Auto-Sync on Recreate ✅
- `recreate-self.sh` syncs all `shared-extensions/` to per-agent config dirs before container recreate
- No more stale extension code after edits

### Remaining (Not Shipped)
- Phase 2: Working-on locks (prevents concurrent file ops)
- Phase 3: Chime-in mechanism (async follow-up from non-primary agents)
