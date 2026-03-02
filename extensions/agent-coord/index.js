/**
 * Agent Coordination v3.6 - Race-free routing
 *
 * Architecture: before_agent_start is the single authoritative decision point.
 * message_received only stores context and handles reactions.
 * message_sending is a safety-net cancel.
 *
 * Hooks:
 *   message_received  → store message context, handle reactions
 *   before_agent_start → compute routing decision (async), return skipReply
 *   message_sending    → safety-net cancel if decision was skip
 *   message_sent       → refresh channel ownership in Redis
 */

'use strict';

const { createClient } = require('redis');
const { decideRouting, classifyIntent, AGENT_IDS, AGENT_ID_SET, ID_TO_NAME } = require('./decide');

const VERSION = 'v3.7';

// ---------------------------------------------------------------------------
// Shared channels - only coordinate in these
// ---------------------------------------------------------------------------

const SHARED_CHANNELS = new Set(
  (process.env.AGENT_COORD_SHARED_CHANNELS || '').split(',').filter(Boolean)
);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let redis = null;
let config = null;
let logger = null;
let redisConnecting = null;

// Message context store: populated by message_received, consumed by before_agent_start
// Keyed by channelId (latest message for that channel)
const messageContexts = new Map();

// Decision store: populated by before_agent_start, consumed by message_sending
const decisions = new Map();

const DRIVING_TTL = 120; // seconds

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------

// Redis connection state: track failures to avoid blocking routing
let redisLastFailure = 0;
const REDIS_BACKOFF_MS = 30000; // don't retry Redis for 30s after failure

async function getRedis() {
  if (redis?.isOpen) return redis;
  // Fast-fail: if Redis failed recently, don't block waiting for reconnect
  if (redisLastFailure && (Date.now() - redisLastFailure) < REDIS_BACKOFF_MS) return null;
  if (redisConnecting) { await redisConnecting; return redis; }
  redisConnecting = (async () => {
    try {
      redis = createClient({
        url: process.env.REDIS_URL || config.redisUrl,
        socket: {
          connectTimeoutMs: 2000,
          reconnectStrategy: (r) => r > 3 ? new Error('Max retries') : Math.min(r * 200, 1000),
        },
      });
      redis.on('error', () => {});
      await redis.connect();
      redisLastFailure = 0;
      logger?.info?.(`agent-coord ${VERSION}: Redis connected`);
    } catch (err) {
      logger?.error?.(`agent-coord ${VERSION}: Redis connect failed: ${err.message}`);
      redisLastFailure = Date.now();
      redis = null;
    } finally { redisConnecting = null; }
  })();
  await redisConnecting;
  return redis;
}

async function getChannelOwner(channelId) {
  try {
    const r = await getRedis();
    if (!r) return undefined;
    const data = await r.get(config.keyPrefix + 'owner:channel:' + channelId);
    if (!data) return undefined;
    const parsed = JSON.parse(data);
    return ID_TO_NAME[parsed.agentId] || parsed.agentId;
  } catch { return undefined; }
}

async function tryRaceLock(messageId) {
  try {
    const r = await getRedis();
    if (!r) return true; // fail-open if Redis down
    const key = config.keyPrefix + 'race:' + messageId;
    const won = await r.set(key, config.agentId, { NX: true, EX: 10 });
    return !!won;
  } catch { return true; }
}

async function setChannelOwner(channelId) {
  try {
    const r = await getRedis();
    if (!r) return;
    const key = config.keyPrefix + 'owner:channel:' + channelId;
    const ttl = config.ownerTtl || 300;
    await r.set(key, JSON.stringify({ agentId: config.agentId, since: Date.now() }), { EX: ttl });
    logger?.info?.(`agent-coord ${VERSION}: setOwner ${channelId} -> ${config.agentId} (TTL ${ttl}s)`);
  } catch (err) {
    logger?.warn?.(`agent-coord ${VERSION}: setOwner error: ${err.message}`);
  }
}

async function setDrivingLock(channelId) {
  try {
    const r = await getRedis();
    if (!r) return;
    const key = config.keyPrefix + 'driving:' + config.agentId + ':' + channelId;
    await r.set(key, JSON.stringify({ sessionKey: 'cross-session', since: Date.now() }), { EX: DRIVING_TTL });
    logger?.info?.(`agent-coord ${VERSION}: [${config.agentId}] set driving lock on ${channelId} (TTL ${DRIVING_TTL}s)`);
  } catch (err) {
    logger?.warn?.(`agent-coord ${VERSION}: setDrivingLock error: ${err.message}`);
  }
}

async function isDriving(channelId) {
  try {
    const r = await getRedis();
    if (!r) return false;
    const key = config.keyPrefix + 'driving:' + config.agentId + ':' + channelId;
    const data = await r.get(key);
    return !!data;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Discord REST - resolve reply-to author
// ---------------------------------------------------------------------------

async function fetchReplyInfo(channelId, messageId, token) {
  if (!channelId || !messageId || !token) {
    return { replyToId: null, replyAuthorId: null, parentMentionedAgents: [] };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const url = 'https://discord.com/api/v10/channels/' + channelId + '/messages/' + messageId;
    const res = await fetch(url, { headers: { Authorization: 'Bot ' + token }, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      logger?.warn?.('agent-coord: fetchReplyInfo: HTTP ' + res.status);
      return { replyToId: null, replyAuthorId: null, parentMentionedAgents: [] };
    }
    const msg = await res.json();
    const parentContent = msg?.referenced_message?.content || '';
    const parentMentionedAgents = [];
    for (const [name, id] of Object.entries(AGENT_IDS)) {
      if (id && new RegExp('<@!?' + id + '>').test(parentContent)) {
        parentMentionedAgents.push(name);
      }
    }
    const result = {
      replyToId: msg?.message_reference?.message_id || null,
      replyAuthorId: msg?.referenced_message?.author?.id || null,
      parentMentionedAgents,
    };
    logger?.info?.('agent-coord: fetchReplyInfo result: replyToId=' + result.replyToId + ' replyAuthorId=' + result.replyAuthorId + ' parentMentions=' + parentMentionedAgents.join(','));
    return result;
  } catch (err) {
    logger?.warn?.('agent-coord: fetchReplyInfo error: ' + String(err));
    return { replyToId: null, replyAuthorId: null, parentMentionedAgents: [] };
  }
}

async function fetchReplyAuthorId(channelId, replyToId, token) {
  if (!channelId || !replyToId || !token) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages/${replyToId}`,
      { headers: { Authorization: `Bot ${token}` }, signal: ctrl.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const msg = await res.json();
    return msg?.author?.id || null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractChannelId(key) {
  if (!key) return null;
  if (key.startsWith('channel:')) return key.slice(8);
  for (const chId of SHARED_CHANNELS) {
    if (key.includes(chId)) return chId;
  }
  return null;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWeightedNameTaskRequest(text, name) {
  if (!text || !name) return false;
  const n = escapeRegex(name);
  const taskVerb = '(?:implement|fix|handle|build|create|update|review|investigate|debug|refactor|write|ship|own|take|do)';
  const patterns = [
    new RegExp('\\b' + n + '\\b[^\\n\\r]{0,48}\\b(?:please\\s+)?(?:i\\s+need\\s+you\\s+to\\s+)?' + taskVerb + '\\b', 'i'),
    new RegExp('\\b(?:please\\s+)?' + n + '[,:]?\\s+(?:can\\s+you\\s+)?(?:please\\s+)?' + taskVerb + '\\b', 'i'),
    new RegExp('\\b' + taskVerb + '\\b[^\\n\\r]{0,48}\\b' + n + '\\b', 'i'),
  ];
  return patterns.some((re) => re.test(text));
}

function isShared(chId) {
  return chId ? SHARED_CHANNELS.has(chId) : false;
}

function storeDecision(channelId, decision, messageId) {
  const key = messageId || channelId;
  const entry = { ...decision, ts: Date.now(), messageId, channelId };
  decisions.set(key, entry);
  if (messageId) decisions.set('latest:' + channelId, key);
  const DECISION_TTL = 120000;
  setTimeout(() => {
    const d = decisions.get(key);
    if (!d) return;
    if (d.used || Date.now() - d.ts > DECISION_TTL) {
      decisions.delete(key);
      if (messageId) {
        const latest = decisions.get('latest:' + channelId);
        if (latest === key) decisions.delete('latest:' + channelId);
      }
    }
  }, DECISION_TTL + 5000);
}

// ---------------------------------------------------------------------------
// Intent Classification (Layer 2)
// ---------------------------------------------------------------------------

const CLASSIFY_PROMPT = `You are a message router for a multi-agent system. Classify which agent should handle this message.

Agents:
- clud: coordinator, architecture, planning, infrastructure, config, deployment, multi-agent orchestration, code review, security
- snoopy: engineer, implementation, coding, refactoring, testing, debugging, research, brainstorming
- echo: public-facing, community, user support, creative writing, content, explanations

Respond with ONLY the agent name (clud, snoopy, or echo). If truly ambiguous, respond "none".

Message: `;

const classifyCache = new Map();
const CLASSIFY_CACHE_TTL = 60000;
const CLASSIFY_CACHE_MAX = 50;

function getCachedClassification(channelId) {
  const entry = classifyCache.get(channelId);
  if (!entry) return null;
  if (Date.now() - entry.ts > CLASSIFY_CACHE_TTL) {
    classifyCache.delete(channelId);
    return null;
  }
  return entry.result;
}

function setCachedClassification(channelId, result) {
  if (classifyCache.size >= CLASSIFY_CACHE_MAX) {
    const oldest = classifyCache.keys().next().value;
    classifyCache.delete(oldest);
  }
  classifyCache.set(channelId, { result, ts: Date.now() });
}

async function classifyIntentLLM(text) {
  const classifyConfig = config.classify;
  if (!classifyConfig?.enabled || classifyConfig?.keywordOnly) return null;
  const llmConfig = classifyConfig?.llm;
  if (!llmConfig?.url || !llmConfig?.model) return null;
  try {
    const ctrl = new AbortController();
    const timeout = llmConfig.timeoutMs || 3000;
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(llmConfig.url + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: llmConfig.model,
        prompt: CLASSIFY_PROMPT + text,
        stream: false,
        options: { num_predict: 20, temperature: 0.1 },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    const answer = (data.response || '').trim().toLowerCase();
    for (const name of ['clud', 'snoopy', 'echo']) {
      if (answer.includes(name)) {
        logger?.info?.(`agent-coord ${VERSION}: LLM classified -> ${name}`);
        return { agent: name, confidence: 0.7, category: 'llm' };
      }
    }
    return null;
  } catch (err) {
    logger?.warn?.(`agent-coord ${VERSION}: LLM classify failed: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reaction detection
// ---------------------------------------------------------------------------

const ACK_PHRASES = /\b(thanks|thank you|thx|appreciate it|no worries|sounds good|lgtm)\b/i;
const ACK_STANDALONE = /^\s*(ok|okay|k|ty|got it|nice|cool|great|perfect|awesome|np|bet|aight|word|dope|fire)[!.\s]*$/i;
const ACK_AGREE_RE = /\b(sounds good|sgtm|makes sense|agreed?|works for me|fine by me|go for it|go ahead|ship it|lgtm|looks good(?: to me)?|cheers)\b/i;
const ACK_MAX_LEN = 120;

const WIN_RE = /\b(shipped|merged|fixed|all green|green again|it works|it's working|we're live|went live|success|big win|huge win|nailed it|deployed)\b/i;
const TECH_UPDATE_RE = /\b(deploying|rollout|roll(?:ed)?\s*back|rollback|restart(?:ed|ing)|bumped|upgrad(?:ed|ing)|migrat(?:ed|ing)|applied?\s+patch|patched|pushed|reran?\s+tests?|\bci\b|pipeline|cron(?:job)?|health\s*check|healthcheck)\b/i;
const PROBLEM_RE = /\b(errors?|crash(?:ed|ing)?|failing|failed|issues?|bugs?|incidents?|outages?|regressions?|panic|exception|stack\s*trace)\b/i;
const AWARE_RE = /\b(fyi|heads up|for your information|for reference|for context)\b/i;
const REACTION_MAX_LEN = 400;

function pickReactionEmoji(text, opts) {
  const t = (text || '').trim().toLowerCase();
  if (!t || t.length > REACTION_MAX_LEN) return null;
  if (opts?.senderId && opts?.thisAgentId && opts.senderId === opts.thisAgentId) return null;

  if (t.length <= ACK_MAX_LEN) {
    if (ACK_PHRASES.test(t) || ACK_STANDALONE.test(t) || ACK_AGREE_RE.test(t)) {
      if (/thank|thx|ty|appreciate/.test(t)) return '🤝';
      if (/nice|cool|great|perfect|awesome|dope|fire/.test(t)) return '🙌';
      if (/lgtm|looks good/.test(t)) return '✅';
      if (/ok|okay|k|got it|sounds good|bet|aight|word|sgtm|makes sense|agreed|works for me|fine by me|go for it|go ahead|ship it|cheers/.test(t)) return '👍';
      return '👍';
    }
  }
  if (WIN_RE.test(t)) return '🎉';
  if (opts?.skipReply === true && PROBLEM_RE.test(t)) return '🫡';
  if (TECH_UPDATE_RE.test(t)) return '👀';
  if (AWARE_RE.test(t)) return '👀';
  return null;
}

function pickAckReaction(text, opts) { return pickReactionEmoji(text, opts); }

async function reactToMessage(channelId, messageId, emoji) {
  const token = process.env[config.discordTokenEnv || 'DISCORD_BOT_TOKEN'];
  if (!token || !messageId) return;
  try {
    const encoded = encodeURIComponent(emoji);
    const res = await fetch(
      'https://discord.com/api/v10/channels/' + channelId + '/messages/' + messageId + '/reactions/' + encoded + '/@me',
      { method: 'PUT', headers: { Authorization: 'Bot ' + token } }
    );
    if (!res.ok) logger?.warn?.('agent-coord ' + VERSION + ': react failed HTTP ' + res.status);
  } catch (err) {
    logger?.warn?.('agent-coord ' + VERSION + ': react error: ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// message_received - store context + handle reactions (fire-and-forget)
// NO routing decisions here. All decisions happen in before_agent_start.
// ---------------------------------------------------------------------------

async function handleMessageReceived(event, ctx) {
  const channelId = extractChannelId(ctx?.conversationId);
  if (!channelId || !isShared(channelId)) return;

  const content = event?.content || '';
  const senderId = event?.metadata?.senderId || '';
  const senderUsername = (event?.metadata?.senderUsername || event?.metadata?.username || '').toLowerCase();
  const senderNameNoDiscrim = senderUsername.replace(/#\d+$/, '');
  const senderIsKnownAgentName = !senderId && (senderNameNoDiscrim === 'clud' || senderNameNoDiscrim === 'snoopy' || senderNameNoDiscrim === 'echo');
  const senderIsAgent = AGENT_ID_SET.has(senderId) || senderIsKnownAgentName;
  if (!AGENT_ID_SET.has(senderId) && senderIsKnownAgentName) {
    logger?.warn?.('agent-coord ' + VERSION + ': senderIsAgent fallback by username=' + senderUsername + ' channel=' + channelId);
  }
  const thisAgent = config.thisAgent;
  if (!thisAgent) return;

  // Store message context for before_agent_start to consume
  const msgCtx = {
    content,
    senderId,
    senderIsAgent,
    senderUsername,
    channelId,
    messageId: event?.metadata?.messageId || null,
    replyToSenderId: event?.metadata?.replyToSenderId || null,
    replyToId: event?.metadata?.reply_to_id || event?.metadata?.replyToId || null,
    rawMentions: event?.metadata?.mentions || null,
    ts: Date.now(),
  };
  messageContexts.set(channelId, msgCtx);

  // TTL: clean up stale contexts after 2 minutes
  setTimeout(() => {
    const stored = messageContexts.get(channelId);
    if (stored && stored.ts === msgCtx.ts) messageContexts.delete(channelId);
  }, 120000);

  // --- Reaction detection (fire-and-forget, doesn't affect routing) ---
  const reactionEmoji = pickReactionEmoji(content, {
    senderId,
    thisAgentId: AGENT_IDS[thisAgent] || '',
  });
  if (reactionEmoji) {
    const isAck = content.length <= ACK_MAX_LEN &&
      (ACK_PHRASES.test(content) || ACK_STANDALONE.test(content) || ACK_AGREE_RE.test(content));

    const ackLockKey = 'ack:' + (event?.metadata?.messageId || channelId);
    let shouldReact = false;
    if (redis?.isOpen) {
      try {
        const set = await redis.set(ackLockKey, thisAgent, { EX: 10, NX: true });
        shouldReact = !!set;
      } catch { shouldReact = (thisAgent === 'clud'); }
    } else {
      shouldReact = (thisAgent === 'clud');
    }

    if (shouldReact) {
      logger?.info?.('agent-coord ' + VERSION + ': [' + thisAgent + '] REACT: ' + reactionEmoji + ' for "' + content.slice(0, 40) + '"');
      await reactToMessage(channelId, event?.metadata?.messageId, reactionEmoji);
    }

    // For acks, store a skip decision directly (ack-react is a special case)
    if (isAck) {
      storeDecision(channelId, { skip: true, reason: 'ack-react' }, event?.metadata?.messageId);
      // Also mark the context so before_agent_start knows it's an ack
      msgCtx.isAck = true;
    }
  }
}

// ---------------------------------------------------------------------------
// before_agent_start - THE authoritative routing decision point (async)
// ---------------------------------------------------------------------------

async function handleBeforeAgentStart(event, ctx) {
  const channelId = extractChannelId(ctx?.sessionKey);
  if (!channelId || !isShared(channelId)) return;

  const thisAgent = config.thisAgent;
  if (!thisAgent) return;

  // Get message context stored by message_received
  const msgCtx = messageContexts.get(channelId);

  // Check for existing decision (ack-react from message_received)
  const existingKey = decisions.get('latest:' + channelId);
  const existingDecision = existingKey ? decisions.get(existingKey) : null;
  if (existingDecision && !existingDecision.used) {
    if (existingDecision.skip) {
      logger?.info?.('agent-coord ' + VERSION + ': [' + thisAgent + '] BLOCK (pre-stored): ' + existingDecision.reason);
      return { skipReply: true };
    }
  }

  if (!msgCtx) {
    // No context from message_received - this can happen for non-shared channel
    // messages or if message_received didn't fire. Fail-open.
    logger?.info?.('agent-coord ' + VERSION + ': [' + thisAgent + '] before_agent_start: no message context, fail-open');
    return;
  }

  const { content, senderId, senderIsAgent, messageId } = msgCtx;

  logger?.info?.('agent-coord ' + VERSION + ': [' + thisAgent + '] before_agent_start: computing routing for msgId=' + (messageId || 'none'));

  // --- Resolve @mentions / direct agent-name mentions ---
  const AGENT_NAME_ALIASES = {
    clud: ['clud', 'cloud', 'big clud'],
    snoopy: ['snoopy'],
    echo: ['echo'],
  };

  const explicitDiscordMentions = [];
  for (const [name, id] of Object.entries(AGENT_IDS)) {
    if (id && new RegExp('<@!?' + id + '>').test(content)) explicitDiscordMentions.push(name);
  }

  const explicitNameMentions = [];
  for (const [agentName, aliases] of Object.entries(AGENT_NAME_ALIASES)) {
    for (const alias of aliases) {
      const a = escapeRegex(alias);
      const directNameMention = new RegExp('(?:^|[\s,;:()\[\]{}])@?' + a + '(?:$|[\s,;:!?.()\[\]{}])', 'i');
      if (directNameMention.test(content)) {
        explicitNameMentions.push(agentName);
        break;
      }
    }
  }

  const agentMentions = Array.from(new Set([...explicitDiscordMentions, ...explicitNameMentions]));

  // --- Resolve weighted name-task mentions ---
  const weightedNameHits = [];
  for (const [agentName, aliases] of Object.entries(AGENT_NAME_ALIASES)) {
    if (aliases.some((alias) => hasWeightedNameTaskRequest(content, alias))) {
      weightedNameHits.push(agentName);
    }
  }

  if (senderIsAgent && agentMentions.length === 0) {
    const looksLikePing = /<@!?\d+>/.test(content) || /@\w+/.test(content);
    if (looksLikePing) {
      logger?.warn?.('agent-coord ' + VERSION + ': senderIsAgent but no resolved agentMentions; msgId=' + (messageId || 'none') + ' sender=' + (senderId || msgCtx.senderUsername || 'unknown') + ' rawMentions=' + JSON.stringify(msgCtx.rawMentions || null));
    }
  }

  // --- Resolve reply-to agent (BLOCKING - this is the key fix) ---
  let replyTo;
  const discordToken = process.env[config.discordTokenEnv || 'DISCORD_BOT_TOKEN'];
  const rawReplyToSenderId = msgCtx.replyToSenderId;
  let refAuthorId = (!rawReplyToSenderId || rawReplyToSenderId === 'none') ? null : rawReplyToSenderId;
  let replyToId = msgCtx.replyToId;
  let parentMentionedAgents = [];

  logger?.info?.('agent-coord ' + VERSION + ': [' + thisAgent + '] reply-debug: replyToSenderId=' + (rawReplyToSenderId || 'none') + ' replyToId=' + (replyToId || 'none') + ' messageId=' + (messageId || 'none'));

  // Fetch from Discord API if not in metadata (AWAITED - blocks model start)
  if (!refAuthorId && !replyToId && discordToken && messageId) {
    const info = await fetchReplyInfo(channelId, messageId, discordToken);
    replyToId = info.replyToId;
    refAuthorId = info.replyAuthorId;
    parentMentionedAgents = info.parentMentionedAgents || [];
  }
  if (!refAuthorId && discordToken && replyToId) {
    refAuthorId = await fetchReplyAuthorId(channelId, replyToId, discordToken);
  }

  if (replyToId && refAuthorId && AGENT_ID_SET.has(refAuthorId)) {
    replyTo = { messageId: replyToId, authorAgentId: ID_TO_NAME[refAuthorId] };
  }

  // --- Get current owner from Redis ---
  const currentOwner = await getChannelOwner(channelId);

  // --- Build input and decide ---
  const input = {
    messageId: messageId || 'unknown',
    channelId,
    senderId,
    isSharedChannel: true,
    isDm: false,
    replyTo,
    mentions: { agentIds: agentMentions, nameHits: weightedNameHits },
    parentMentionedAgents,
    currentOwner,
    senderIsAgent,
    thisAgent,
  };

  const result = decideRouting(input);

  // Cross-session driving check
  const remoteIsDriving = await isDriving(channelId);
  if (remoteIsDriving && result.allow) {
    logger?.info?.(`agent-coord ${VERSION}: [${thisAgent}] DEFER (remote-session-driving) original=${result.reason}`);
    storeDecision(channelId, { skip: true, reason: 'remote-session-driving' }, messageId);
    return { skipReply: true };
  }

  // Layer 2: Intent Classification for ambiguous messages
  const shouldClassify = !senderIsAgent && result.priority < 90 &&
    (result.reason === 'open-race' || result.reason === 'owner-bias' || result.reason.startsWith('owned-by:'));
  if (shouldClassify) {
    let classification = classifyIntent(content);
    if (!classification) {
      classification = getCachedClassification(channelId);
    }
    if (!classification) {
      classification = await classifyIntentLLM(content);
      if (classification) setCachedClassification(channelId, classification);
    }

    if (classification && classification.agent) {
      if (classification.agent === thisAgent) {
        logger?.info?.(`agent-coord ${VERSION}: [${thisAgent}] ALLOW (classified:${classification.category}) -> ${classification.agent}`);
        storeDecision(channelId, { skip: false, reason: 'classified:' + classification.category }, messageId);
        return; // allow
      } else {
        logger?.info?.(`agent-coord ${VERSION}: [${thisAgent}] DENY (classified:${classification.category}) -> ${classification.agent}`);
        storeDecision(channelId, { skip: true, reason: 'classified-to:' + classification.agent }, messageId);
        return { skipReply: true };
      }
    }

    // Ambiguous classification - fall back to Gate decision
    if (result.reason === 'open-race') {
      if (!messageId) {
        storeDecision(channelId, { skip: true, reason: 'race-no-msgid' }, messageId);
        return { skipReply: true };
      }
      const won = await tryRaceLock(messageId);
      if (!won) {
        logger?.info?.(`agent-coord ${VERSION}: [${thisAgent}] DENY (race-lost)`);
        storeDecision(channelId, { skip: true, reason: 'race-lost' }, messageId);
        return { skipReply: true };
      }
      logger?.info?.(`agent-coord ${VERSION}: [${thisAgent}] ALLOW (race-won)`);
      storeDecision(channelId, { skip: false, reason: 'race-won' }, messageId);
      return; // allow
    }

    // Owner-bias with ambiguous classification
    if (!result.allow) {
      logger?.info?.(`agent-coord ${VERSION}: [${thisAgent}] DENY (${result.reason}, classify-ambiguous)`);
      storeDecision(channelId, { skip: true, reason: result.reason + ':classify-ambiguous' }, messageId);
      return { skipReply: true };
    }
    logger?.info?.(`agent-coord ${VERSION}: [${thisAgent}] ALLOW (${result.reason}, classify-ambiguous)`);
    storeDecision(channelId, { skip: false, reason: result.reason + ':classify-ambiguous' }, messageId);
    return; // allow
  }

  // Hard target or sibling filter result
  if (!result.allow) {
    logger?.info?.(`agent-coord ${VERSION}: [${thisAgent}] DENY (${result.reason}) pri=${result.priority}`);
    storeDecision(channelId, { skip: true, reason: result.reason }, messageId);
    return { skipReply: true };
  }

  logger?.info?.(`agent-coord ${VERSION}: [${thisAgent}] ALLOW (${result.reason}) pri=${result.priority}`);
  storeDecision(channelId, { skip: false, reason: result.reason }, messageId);
  return; // allow
}

// ---------------------------------------------------------------------------
// message_sending - safety-net cancel
// ---------------------------------------------------------------------------

function handleMessageSending(event, ctx) {
  const channelId = extractChannelId(event?.to)
    || (ctx?.channelId && /^\d+$/.test(ctx.channelId) ? ctx.channelId : null)
    || extractChannelId(ctx?.conversationId)
    || extractChannelId(ctx?.sessionKey);
  if (!channelId || !isShared(channelId)) return;

  const latestKey = decisions.get('latest:' + channelId);
  const decision = latestKey ? decisions.get(latestKey) : decisions.get(channelId);

  if (!decision) {
    logger?.warn?.(`agent-coord ${VERSION}: [${config.agentId}] CANCEL outbound: no decision (safety-net)`);
    return { cancel: true };
  }

  if (decision.skip) {
    logger?.info?.(`agent-coord ${VERSION}: [${config.agentId}] CANCEL outbound: ${decision.reason}`);
    decision.used = true;
    return { cancel: true };
  }
  decision.used = true;

  // Cross-session driving detection
  const sessionKey = ctx?.sessionKey || '';
  const isCrossSession = !sessionKey.includes(channelId);
  if (isCrossSession) {
    setDrivingLock(channelId).catch(() => {});
    logger?.info?.(`agent-coord ${VERSION}: [${config.agentId}] message_sending CROSS-SESSION to ${channelId}`);
  }

  setChannelOwner(channelId).catch(() => {});
}

// ---------------------------------------------------------------------------
// Plugin entrypoint
// ---------------------------------------------------------------------------

const plugin = {
  id: 'agent-coord',
  name: 'Agent Coordination',
  description: 'Multi-agent channel coordination v3.6 - race-free routing',

  register(api) {
    config = api.pluginConfig || {};
    logger = api.logger;

    if (!config.enabled) {
      logger?.info?.(`agent-coord ${VERSION}: disabled`);
      return;
    }

    config.keyPrefix = config.keyPrefix || 'agent-coord:';
    config.ownerTtl = config.ownerTtl || 300;

    const thisAgent = ID_TO_NAME[config.discordUserId];
    if (!thisAgent) {
      logger?.error?.(`agent-coord ${VERSION}: invalid discordUserId '${config.discordUserId}' - plugin disabled`);
      return;
    }
    config.thisAgent = thisAgent;

    logger?.info?.(`agent-coord ${VERSION}: init (agent=${config.agentId}, thisAgent=${thisAgent}, discord=${config.discordUserId})`);

    api.on('message_received', handleMessageReceived);
    api.on('before_agent_start', handleBeforeAgentStart);
    api.on('message_sending', handleMessageSending);

    logger?.info?.(`agent-coord ${VERSION}: hooks registered`);
  }
};

module.exports = plugin;
