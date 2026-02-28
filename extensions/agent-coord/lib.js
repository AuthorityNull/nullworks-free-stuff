/**
 * Agent Coordination Library
 * Redis-based multi-agent conversation coordination
 */

const { createClient } = require('redis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CONV_TTL = 300; // 5 minutes - conversations auto-release
const CLAIM_WINDOW = 120; // 2 minutes - cooldown after another agent responds

let client = null;

async function getClient() {
  if (!client) {
    client = createClient({ url: REDIS_URL });
    client.on('error', err => console.error('Redis error:', err));
    await client.connect();
  }
  return client;
}

async function disconnect() {
  if (client) {
    await client.disconnect();
    client = null;
  }
}

/**
 * Check if a conversation is claimed by another agent
 * @param {string} channelId - Discord channel ID
 * @param {string} agentId - Current agent's ID (to exclude self)
 * @returns {object} { claimed: bool, owner: string|null, age: number }
 */
async function checkConversation(channelId, agentId) {
  const r = await getClient();
  const key = `agent:conv:${channelId}`;
  const data = await r.hGetAll(key);
  
  if (!data || !data.owner) {
    return { claimed: false, owner: null, age: 0 };
  }
  
  const age = Math.floor((Date.now() - parseInt(data.timestamp)) / 1000);
  
  // If we own it, not "claimed" by another
  if (data.owner === agentId) {
    return { claimed: false, owner: agentId, age, self: true };
  }
  
  // If claim is old (past cooldown), consider it expired
  if (age > CLAIM_WINDOW) {
    return { claimed: false, owner: data.owner, age, expired: true };
  }
  
  return { claimed: true, owner: data.owner, age };
}

/**
 * Claim a conversation for this agent
 * @param {string} channelId - Discord channel ID
 * @param {string} agentId - Agent claiming the conversation
 * @param {string} messageId - Message ID that triggered the claim (optional)
 * @returns {object} { success: bool, previousOwner: string|null }
 */
async function claimConversation(channelId, agentId, messageId = null) {
  const r = await getClient();
  const key = `agent:conv:${channelId}`;
  
  // Get previous owner for logging
  const prev = await r.hGet(key, 'owner');
  
  // Set new claim
  await r.hSet(key, {
    owner: agentId,
    timestamp: Date.now().toString(),
    messageId: messageId || '',
  });
  await r.expire(key, CONV_TTL);
  
  return { success: true, previousOwner: prev || null };
}

/**
 * Yield/release a conversation
 * @param {string} channelId - Discord channel ID
 * @param {string} agentId - Agent yielding (must be current owner)
 * @returns {object} { success: bool }
 */
async function yieldConversation(channelId, agentId) {
  const r = await getClient();
  const key = `agent:conv:${channelId}`;
  
  const owner = await r.hGet(key, 'owner');
  
  // Only yield if we're the owner
  if (owner !== agentId) {
    return { success: false, reason: 'not_owner', currentOwner: owner };
  }
  
  await r.del(key);
  return { success: true };
}

/**
 * Get status of all active conversations
 * @returns {array} List of active conversations
 */
async function listConversations() {
  const r = await getClient();
  const keys = await r.keys('agent:conv:*');
  
  const conversations = [];
  for (const key of keys) {
    const data = await r.hGetAll(key);
    const channelId = key.replace('agent:conv:', '');
    const age = Math.floor((Date.now() - parseInt(data.timestamp)) / 1000);
    conversations.push({
      channelId,
      owner: data.owner,
      age,
      messageId: data.messageId || null,
    });
  }
  
  return conversations;
}

/**
 * Log an agent action (for debugging/observability)
 * @param {string} agentId - Agent performing action
 * @param {string} action - Action type (check, claim, yield, respond)
 * @param {object} details - Additional details
 */
async function logAction(agentId, action, details = {}) {
  const r = await getClient();
  const entry = JSON.stringify({
    agent: agentId,
    action,
    timestamp: Date.now(),
    ...details,
  });
  
  // Keep last 100 actions
  await r.lPush('agent:log', entry);
  await r.lTrim('agent:log', 0, 99);
}

/**
 * Get recent action log
 * @param {number} limit - Max entries to return
 * @returns {array} Recent actions
 */
async function getLog(limit = 20) {
  const r = await getClient();
  const entries = await r.lRange('agent:log', 0, limit - 1);
  return entries.map(e => JSON.parse(e));
}

module.exports = {
  checkConversation,
  claimConversation,
  yieldConversation,
  listConversations,
  logAction,
  getLog,
  disconnect,
  CLAIM_WINDOW,
  CONV_TTL,
};
