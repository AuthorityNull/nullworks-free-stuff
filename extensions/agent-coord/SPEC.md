# Agent Coordination v2 - Spec

## Overview
Pure routing function + dumb hook plumbing. All decision logic lives in `decideRouting()`, tested independently of OpenClaw hooks, Discord REST, or Redis.

## Types

```ts
type AgentId = 'clud' | 'snoopy' | 'echo';

interface RoutingInput {
  messageId: string;
  channelId: string;
  senderId: string;          // Discord user/bot ID
  isSharedChannel: boolean;  // only coordinate in shared channels
  isDm: boolean;

  replyTo?: {
    messageId: string;
    authorAgentId?: AgentId;  // set if replied-to author is a known agent
  };

  mentions: {
    agentIds: AgentId[];      // explicit <@id> mentions mapped to agent names
  };

  currentOwner?: AgentId;     // advisory, from Redis
  senderIsAgent: boolean;     // true if senderId is a known agent bot
  thisAgent: AgentId;         // which agent is evaluating
}

interface AgentDecision {
  allow: boolean;
  reason: string;
  priority: number;           // higher = stronger claim
}
```

## Priority Levels

| Priority | Signal | Description |
|----------|--------|-------------|
| 100 | reply-target | Message is a reply to this agent's message |
| 90 | explicit-mention | This agent was @mentioned by Discord ID |
| 50 | owner-bias | This agent owns the channel (advisory) |
| 0 | no-signal | No routing signal for this agent |

Name hits (plain text mentions without @) are intentionally excluded - they created more edge cases than they solved.

## Core Rules

1. **DM or non-shared channel** - always allow, skip coordination entirely
2. **Sender is agent + this agent not targeted** - deny (sibling filter)
3. **Sender is agent + this agent IS targeted** (mention/reply) - allow (sibling bypass)
4. **Hard target exists** (reply-to or @mention for ANY agent):
   - Targeted agent(s): allow
   - Non-targeted agents: deny
5. **No hard target, owner exists** - owner: allow, others: deny
6. **No hard target, no owner** - all agents: allow (race to respond, ownership claimed on send)

## Truth Table

| # | Scenario | Clud | Snoopy | Echo | Notes |
|---|----------|------|--------|------|-------|
| 1 | Human says "hey" in #cludsbuds, no owner | allow | allow | allow | Race - first responder claims ownership |
| 2 | Human says "hey" in #cludsbuds, Clud owns | allow | deny | deny | Owner bias |
| 3 | Human @mentions Snoopy | deny | allow | deny | Hard target |
| 4 | Human replies to Echo's message | deny | deny | allow | Reply target |
| 5 | Human @mentions Snoopy AND replies to Clud | allow | allow | deny | Both targeted |
| 6 | Snoopy sends msg, no mentions | deny | deny | deny | Sibling filter - no agent targeted |
| 7 | Snoopy @mentions Clud | allow | deny | deny | Sibling bypass via mention |
| 8 | Human says "Snoopy look this up" (no @) | allow | allow | allow | Name hit ignored, no target = open race |
| 9 | Human says "hey" in DM | allow | allow | allow | DMs skip coordination |
| 10 | Human @mentions Clud AND Echo | allow | deny | allow | Multi-mention |
| 11 | Human replies to Snoopy, @mentions Echo | deny | allow | allow | Both targeted (reply + mention) |
| 12 | Echo sends msg, @mentions Clud | allow | deny | deny | Sibling bypass for Clud only |
| 13 | Human says "hey" in #errors (non-shared) | allow | allow | allow | Non-shared skips coordination |
| 14 | Owner expired, human says "hey" | allow | allow | allow | Same as no owner |

## Hook Responsibilities

### message_received
1. Extract channelId, messageId, senderId from event/ctx
2. Resolve reply-to author (Discord REST, 3s timeout, fail-soft to no replyTo)
3. Map @mentions to agentIds
4. Build RoutingInput
5. Call decideRouting(input) for thisAgent
6. If result is `open-race`: Redis NX lock per messageId - winner allows, losers deny
7. Store decision keyed by channelId (30s TTL)

Note: Decisions are keyed by channelId (not messageId) because `before_agent_start` only has access to sessionKey which contains the channelId. This means rapid sequential messages in the same channel can overwrite each other's decisions. Acceptable for current usage patterns.

### before_agent_start
1. Look up decision by channelId (extracted from sessionKey)
2. If missing: fail-open (allow) - no REST available in this hook
3. If allow=false → return { skipReply: true }

### message_sent
1. Update channel ownership in Redis (TTL: 300s default, configurable via `ownerTtl`)

### message_sending
1. Read decision for channelId (safety net - only fires if `before_agent_start` was skipped)
2. If skip=true → return { cancel: true }

## Redis Keys
- `{keyPrefix}owner:channel:{channelId}` - JSON `{ agentId, since }`, TTL 300s (default keyPrefix: `agent-coord:`)
- `{keyPrefix}race:{messageId}` - agent name, NX lock, TTL 10s (open-race tiebreaker)
- No more per-channel race locks or domain scoring

## Known Limitations

- **Redis down during race:** `tryRaceLock` fail-opens - all agents respond. Acceptable: Redis downtime is rare and temporary; triple-reply is better than zero replies.
- **Missing messageId during race:** Fail-closed (deny). Each agent would generate a unique `Date.now()` key, defeating NX. Practically never happens in Discord (messageId always in metadata).
- **Discord REST failure:** Reply-to resolution degrades - `replyTo` stays undefined, no hard target detected, falls to owner/race. Same behavior as v1.
- **Rapid sequential messages in same channel:** Second message's decision overwrites the first (channelId keying). Only matters if two humans message within milliseconds and both trigger `message_received` before the first `before_agent_start` fires.
- **`message_sending` safety net:** Decision is typically consumed and deleted by `before_agent_start`. The `message_sending` cancel only fires if that hook was skipped entirely by the runtime.

## Migration
- v2 replaces v1 entirely (same file path, same plugin ID)
- Config shape unchanged (enabled, redisUrl, agentId, etc.)
- No new dependencies
