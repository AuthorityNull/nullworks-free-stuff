/**
 * Intent Supervisor - Phase 1+2+3
 * Keyword interrupt + busy detection + steer queue + task dedup + LLM classification
 */

const crypto = require('crypto');
const http = require('http');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const CLASSIFY_MODEL = process.env.CLASSIFY_MODEL || 'qwen2.5:3b';
const CLASSIFY_TIMEOUT_MS = 2000;

const CLASSIFY_PROMPT = `You classify a new message that arrived while an AI agent is busy with a task.
Reply with EXACTLY one word:
- modify: user wants to REPLACE the current task entirely (e.g. "do X instead", "forget that", "switch to Y")
- unrelated: message is about a COMPLETELY DIFFERENT topic than the current task
- clarify: user is refining, adding to, or giving more detail about the current task (e.g. "also include X", "make sure to check Y")

Examples:
Task: search for restaurants | Msg: search for hotels instead -> modify
Task: search for restaurants | Msg: what time is it -> unrelated
Task: search for restaurants | Msg: include ones with wifi -> clarify

Task: {task}
Msg: {msg}

Classification:`;

const STOP_KEYWORDS = new Set([
  'stop', 'cancel', 'abort', 'nevermind', 'nvm', 'nm', 'nah stop', 'stop that'
]);
const MAX_KEYWORD_LEN = 30;

function busyKey(agentId, convKey) { return `agent-coord:busy:${agentId}:${convKey}`; }
function handledKey(agentId, messageId) { return `agent-coord:handled:${agentId}:${messageId}`; }
function abortKey(agentId, convKey) { return `agent-coord:abort:${agentId}:${convKey}`; }
function steerKey(agentId, convKey) { return `agent-coord:steer:${agentId}:${convKey}`; }
function taskKey(agentId, hash) { return `agent-coord:tasks:${agentId}:${hash}`; }
function spawnKey(agentId, convKey) { return `agent-coord:spawn:${agentId}:${convKey}`; }

async function checkBusy(redis, agentId, convKey) {
  if (!redis) return null;
  const val = await redis.get(busyKey(agentId, convKey));
  if (!val) return null;
  try { return JSON.parse(val); } catch { return { task: val }; }
}

async function setBusy(redis, agentId, convKey, taskSummary) {
  if (!redis) return;
  await redis.set(busyKey(agentId, convKey), JSON.stringify({ task: taskSummary, since: Date.now() }), { EX: 300 });
}

async function clearBusy(redis, agentId, convKey) {
  if (!redis) return;
  await redis.del(busyKey(agentId, convKey));
}


async function llmClassify(taskSummary, message) {
  const prompt = CLASSIFY_PROMPT.replace('{task}', taskSummary).replace('{msg}', message);
  const body = JSON.stringify({
    model: CLASSIFY_MODEL,
    prompt,
    stream: false,
    options: { num_predict: 5, temperature: 0 }
  });
  
  return new Promise((resolve) => {
    const url = new URL(OLLAMA_URL + '/api/generate');
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: CLASSIFY_TIMEOUT_MS
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const word = (parsed.response || '').trim().toLowerCase().split(/\s+/)[0];
          if (['modify', 'unrelated', 'clarify'].includes(word)) {
            resolve(word);
          } else {
            resolve(null); // unrecognized -> fallback
          }
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

async function classifyMessage(redis, agentId, convKey, message, messageId) {
  const busy = await checkBusy(redis, agentId, convKey);
  if (!busy) return null;
  const trimmed = (message || '').trim().toLowerCase();
  if (trimmed.length <= MAX_KEYWORD_LEN && STOP_KEYWORDS.has(trimmed)) {
    return { action: 'interrupt', keyword: trimmed };
  }
  // Phase 3: LLM classification
  const llmResult = await llmClassify(busy.task || '', message || '');
  if (llmResult === 'modify') {
    return { action: 'interrupt', keyword: null, llmClassified: true };
  } else if (llmResult === 'unrelated') {
    return { action: 'spawn' };
  } else if (llmResult === 'clarify') {
    return { action: 'steer' };
  }
  // Fallback: if LLM fails/times out, default to steer (safe)
  return { action: 'steer' };
}

async function markHandled(redis, agentId, messageId, action) {
  if (!redis) return;
  await redis.set(handledKey(agentId, messageId), action, { EX: 60 });
}

async function isHandled(redis, agentId, messageId) {
  if (!redis || !messageId) return false;
  const val = await redis.get(handledKey(agentId, messageId));
  return !!val;
}

async function setAbort(redis, agentId, convKey, reason) {
  if (!redis) return;
  await redis.set(abortKey(agentId, convKey), reason || 'user-interrupt', { EX: 60 });
}

async function checkAbort(redis, agentId, convKey) {
  if (!redis) return null;
  const val = await redis.getDel(abortKey(agentId, convKey));
  return val || null;
}

async function pushSteer(redis, agentId, convKey, message) {
  if (!redis) return;
  const key = steerKey(agentId, convKey);
  await redis.rPush(key, message);
  await redis.expire(key, 120);
}

async function popSteer(redis, agentId, convKey) {
  if (!redis) return null;
  const key = steerKey(agentId, convKey);
  const msgs = await redis.lRange(key, 0, -1);
  if (msgs && msgs.length > 0) {
    await redis.del(key);
    return msgs;
  }
  return null;
}


async function pushSpawn(redis, agentId, convKey, message) {
  if (!redis) return;
  const key = spawnKey(agentId, convKey);
  await redis.set(key, JSON.stringify({ message, decidedAt: Date.now() }), { EX: 120 });
}

async function popSpawn(redis, agentId, convKey) {
  if (!redis) return null;
  const key = spawnKey(agentId, convKey);
  const val = await redis.getDel(key);
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

function hashMessage(message) {
  const normalized = (message || '').trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

async function checkDuplicate(redis, agentId, message) {
  if (!redis) return false;
  const hash = hashMessage(message);
  const val = await redis.get(taskKey(agentId, hash));
  return !!val;
}

async function setTask(redis, agentId, message) {
  if (!redis) return;
  const hash = hashMessage(message);
  await redis.set(taskKey(agentId, hash), JSON.stringify({ since: Date.now() }), { EX: 300 });
}

async function clearTask(redis, agentId, message) {
  if (!redis) return;
  const hash = hashMessage(message);
  await redis.del(taskKey(agentId, hash));
}

module.exports = {
  checkBusy, setBusy, clearBusy,
  classifyMessage, markHandled, isHandled,
  setAbort, checkAbort,
  pushSteer, popSteer,
  hashMessage, checkDuplicate, setTask, clearTask,
  llmClassify, pushSpawn, popSpawn
};
