/**
 * Minion Lifecycle Plugin v3.2.0
 *
 * Auto-posts sub-agent spawn, completion, and progress events to a Discord webhook.
 * Fire-and-forget - never blocks the agent loop, never throws.
 *
 * Hooks:
 *   subagent_spawned - authoritative sub-agent spawn signal
 *   subagent_ended   - authoritative sub-agent completion signal
 *
 * Progress watcher:
 *   Polls /workspace/tmp/minion-progress/<label>.log for new lines every N seconds.
 *   Posts new lines to the webhook channel.
 *   Cleans up finished progress files after completion is detected.
 */

const fs = require('fs');
const path = require('path');

const VERSION = 'v3.4.0';
const PROGRESS_DIR = '/workspace/tmp/minion-progress';
const DEFAULT_POLL_MS = 15000; // 15 seconds
const DEFAULT_RETRY_MAX = 5;
const DEFAULT_RETRY_BASE_MS = 1500;
const DEFAULT_RETRY_JITTER_MS = 400;
const OFFSETS_FILE = path.join(PROGRESS_DIR, '.offsets.json');
const RUNS_FILE = path.join(PROGRESS_DIR, '.runs.json');

const _seenApis = new WeakSet();
let _pollTimer = null;

// label -> number of lines already posted
const _lineOffsets = new Map();
// runId -> { label, childSessionKey, startedAt }
const _runMeta = new Map();
// dedupe key -> last post timestamp
const _recentPosts = new Map();
const DEDUPE_WINDOW_MS = 60000;

function safeJsonRead(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function safeJsonWrite(filePath, value) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(value));
  } catch (_) {
    // fire-and-forget
  }
}

function loadState() {
  const offsets = safeJsonRead(OFFSETS_FILE, {});
  for (const [k, v] of Object.entries(offsets)) {
    _lineOffsets.set(k, Number(v) || 0);
  }

  const runs = safeJsonRead(RUNS_FILE, {});
  for (const [runId, meta] of Object.entries(runs)) {
    if (!runId || !meta || typeof meta !== 'object') continue;
    _runMeta.set(runId, {
      label: typeof meta.label === 'string' ? meta.label : '',
      childSessionKey: typeof meta.childSessionKey === 'string' ? meta.childSessionKey : '',
      startedAt: Number(meta.startedAt) || Date.now(),
    });
  }
}

function saveState() {
  safeJsonWrite(OFFSETS_FILE, Object.fromEntries(_lineOffsets));
  safeJsonWrite(RUNS_FILE, Object.fromEntries(_runMeta));
}

let _retryCfg = {
  maxRetries: DEFAULT_RETRY_MAX,
  baseDelayMs: DEFAULT_RETRY_BASE_MS,
  jitterMs: DEFAULT_RETRY_JITTER_MS,
};

function computeRetryDelayMs(attempt) {
  const base = Math.max(0, Number(_retryCfg.baseDelayMs) || DEFAULT_RETRY_BASE_MS);
  const jitter = Math.max(0, Number(_retryCfg.jitterMs) || DEFAULT_RETRY_JITTER_MS);
  const exp = Math.min(attempt, 6);
  const backoff = base * Math.pow(2, exp);
  const rand = jitter ? Math.floor(Math.random() * (jitter + 1)) : 0;
  return backoff + rand;
}

function isRetriableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

function postToDiscord(webhookUrl, content, logger, attempt = 0) {
  try {
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
      .then(res => {
        if (res.ok) return;
        const retriable = isRetriableStatus(res.status);
        const maxRetries = Math.max(0, Number(_retryCfg.maxRetries) || DEFAULT_RETRY_MAX);
        if (retriable && attempt < maxRetries) {
          const delay = computeRetryDelayMs(attempt);
          logger?.warn?.(`[minion-lifecycle] Webhook ${res.status}, retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
          setTimeout(() => postToDiscord(webhookUrl, content, logger, attempt + 1), delay);
          return;
        }
        logger?.warn?.(`[minion-lifecycle] Webhook POST failed: status=${res.status}`);
      })
      .catch(err => {
        const maxRetries = Math.max(0, Number(_retryCfg.maxRetries) || DEFAULT_RETRY_MAX);
        if (attempt < maxRetries) {
          const delay = computeRetryDelayMs(attempt);
          logger?.warn?.(`[minion-lifecycle] Webhook error: ${err.message}; retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
          setTimeout(() => postToDiscord(webhookUrl, content, logger, attempt + 1), delay);
          return;
        }
        logger?.warn?.(`[minion-lifecycle] Webhook error: ${err.message}`);
      });
  } catch (err) {
    logger?.warn?.(`[minion-lifecycle] Webhook error: ${err.message}`);
  }
}

function truncate(str, max) {
  if (!str) return '';
  const single = String(str).replace(/\n/g, ' ').trim();
  return single.length > max ? single.slice(0, max) + '…' : single;
}

function shouldPostDedup(key) {
  try {
    const now = Date.now();
    const last = _recentPosts.get(key) || 0;
    if (now - last < DEDUPE_WINDOW_MS) return false;
    _recentPosts.set(key, now);
    // lightweight cleanup
    if (_recentPosts.size > 400) {
      for (const [k, ts] of _recentPosts.entries()) {
        if (now - ts > DEDUPE_WINDOW_MS * 2) _recentPosts.delete(k);
      }
    }
    return true;
  } catch (_) {
    return true;
  }
}

function getResultFilePath(runId, childSessionKey) {
  if (!runId && !childSessionKey) return '';
  try {
    const base = '/workspace/tmp/subagent-results';
    if (!fs.existsSync(base)) return '';
    const files = fs.readdirSync(base);
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      if (runId && f.includes(runId)) return path.join(base, f);
      if (childSessionKey && f.includes(childSessionKey.replace(/[:]/g, '_'))) return path.join(base, f);
    }
  } catch (_) {
    // ignore
  }
  return '';
}

function parseResultFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const txt = fs.readFileSync(filePath, 'utf-8');
    const lines = txt.split('\n');
    let label = '';
    let status = '';
    let reason = '';
    for (const line of lines) {
      if (!label) {
        const m = line.match(/^Task:\s*(.+)$/i);
        if (m) label = m[1].trim();
      }
      if (!status) {
        const m = line.match(/^Status:\s*(.+)$/i);
        if (m) status = m[1].trim().toLowerCase();
      }
      if (!reason) {
        const m = line.match(/^Error:\s*(.+)$/i);
        if (m) reason = m[1].trim();
      }
    }
    return { label, status, reason };
  } catch (_) {
    return null;
  }
}

function normalizeStatusFromResult(status, reason) {
  const s = (status || '').toLowerCase();
  const r = (reason || '').toLowerCase();
  if (s.includes('completed') || s === 'ok' || s === 'done' || s === 'success') {
    return { status: 'Done', emoji: '✅', failed: false };
  }
  if (s.includes('timeout') || r.includes('timeout') || r.includes('timed out')) {
    return { status: 'Timeout', emoji: '⏱️', failed: true };
  }
  if (s.includes('failed') || s.includes('error') || r.includes('error') || r.includes('failed')) {
    return { status: 'Failed', emoji: '❌', failed: true };
  }
  return { status: 'Finished', emoji: 'ℹ️', failed: false };
}

function ensureProgressDir() {
  try {
    if (!fs.existsSync(PROGRESS_DIR)) fs.mkdirSync(PROGRESS_DIR, { recursive: true });
  } catch (_) {
    // silently ignore
  }
}

function deriveLabelFromSessionKey(sessionKey) {
  if (!sessionKey || typeof sessionKey !== 'string') return '';
  // Example: agent:spawn:subagent:minion-foo
  const tail = sessionKey.split(':').pop() || '';
  return tail.trim();
}

function normalizeLabel(label, fallbackSessionKey) {
  const clean = (label || '').toString().trim();
  if (clean) return clean;
  const derived = deriveLabelFromSessionKey(fallbackSessionKey);
  return derived || 'unlabeled';
}

function outcomeToStatus(outcome, reason) {
  const o = (outcome || '').toLowerCase();
  const r = (reason || '').toLowerCase();

  if (o === 'ok') return { status: 'Done', emoji: '✅', failed: false };
  if (o === 'timeout' || r.includes('timeout') || r.includes('timed out')) {
    return { status: 'Timeout', emoji: '⏱️', failed: true };
  }
  if (o === 'error' || r.includes('error') || r.includes('failed')) {
    return { status: 'Failed', emoji: '❌', failed: true };
  }
  if (o === 'killed' || o === 'reset' || o === 'deleted') {
    return { status: 'Stopped', emoji: '🛑', failed: true };
  }
  return { status: 'Finished', emoji: 'ℹ️', failed: false };
}

function pollProgressFiles(webhookUrl, logger) {
  try {
    if (!fs.existsSync(PROGRESS_DIR)) return;

    const files = fs.readdirSync(PROGRESS_DIR).filter(f => f.endsWith('.log'));
    for (const file of files) {
      const label = file.replace(/\.log$/, '');
      const filePath = path.join(PROGRESS_DIR, file);

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        const offset = _lineOffsets.get(label) || 0;

        if (lines.length <= offset) continue;

        const newLines = lines.slice(offset);
        for (const line of newLines) {
          postToDiscord(webhookUrl, `📡 **Progress** \`${label}\`: ${truncate(line, 500)}`, logger);
        }

        _lineOffsets.set(label, lines.length);
        saveState();
      } catch (_) {
        // File might have been deleted between readdir and readFile
      }
    }
  } catch (err) {
    logger?.warn?.(`[minion-lifecycle] Progress poll error: ${err.message}`);
  }
}

function cleanupProgressFile(label, logger) {
  try {
    if (!label) return;
    const filePath = path.join(PROGRESS_DIR, `${label}.log`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger?.info?.(`[minion-lifecycle] Cleaned up progress file: ${filePath}`);
    }
    _lineOffsets.delete(label);
    saveState();
  } catch (_) {
    // silently ignore cleanup failures
  }
}

function register(api) {
  const cfg = api.pluginConfig || {};
  const logger = api.logger;

  if (!cfg?.enabled) {
    logger?.info?.(`[minion-lifecycle] ${VERSION}: disabled (cfg.enabled=${cfg?.enabled})`);
    return;
  }

  const webhookUrl = cfg.webhookUrl;
  const agentLabel = cfg.agentLabel || 'clud';
  const pollMs = cfg.progressPollMs || DEFAULT_POLL_MS;
  const errorMention = cfg.errorMention || ''; // e.g. '<@OWNER_DISCORD_ID>'
  _retryCfg = {
    maxRetries: Number.isFinite(Number(cfg.retryMax)) ? Number(cfg.retryMax) : DEFAULT_RETRY_MAX,
    baseDelayMs: Number.isFinite(Number(cfg.retryBaseMs)) ? Number(cfg.retryBaseMs) : DEFAULT_RETRY_BASE_MS,
    jitterMs: Number.isFinite(Number(cfg.retryJitterMs)) ? Number(cfg.retryJitterMs) : DEFAULT_RETRY_JITTER_MS,
  };

  if (!webhookUrl) {
    logger?.warn?.(`[minion-lifecycle] ${VERSION}: No webhookUrl configured, plugin inactive`);
    return;
  }

  if (_seenApis.has(api)) return;
  _seenApis.add(api);

  // Clear stale poll timer from previous gateway lifecycle (SIGUSR1)
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }

  logger?.info?.(`[minion-lifecycle] ${VERSION}: active (agent=${agentLabel}, progressPoll=${pollMs}ms)`);

  ensureProgressDir();
  loadState();

  _pollTimer = setInterval(() => pollProgressFiles(webhookUrl, logger), pollMs);
  if (_pollTimer?.unref) _pollTimer.unref();

  // Fallback spawn signal when subagent_spawned hook is unavailable in runtime path
  api.on('after_tool_call', (event, _ctx) => {
    try {
      const tool = event?.toolName || event?.name || event?.tool || '';
      const isError = Boolean(event?.isError || event?.error);
      if (tool !== 'sessions_spawn') return;
      if (isError) return;

      const params = event?.params || event?.input || {};
      const result = event?.result || event?.output || {};
      const runId = result?.runId || '';
      const childSessionKey = result?.childSessionKey || '';
      const label = normalizeLabel(params?.label, childSessionKey);
      const agentId = params?.agentId || 'default';
      const mode = params?.mode || 'run';
      const dedupeKey = `spawn:${label}`;

      if (!shouldPostDedup(dedupeKey)) return;

      _lineOffsets.set(label, 0);
      if (runId) {
        _runMeta.set(runId, {
          label,
          childSessionKey,
          startedAt: Date.now(),
        });
      }
      saveState();

      postToDiscord(webhookUrl, `🔄 **Spawned:** \`${label}\` (${agentId}, mode=${mode})`, logger);
    } catch (err) {
      logger?.warn?.(`[minion-lifecycle] after_tool_call fallback error: ${err.message}`);
    }
  });

  // Fallback completion signal via injected system message announce
  const ANNOUNCE_RE = /\[System Message\].*?A (subagent task|cron job) "([^"]+)" just (.+?)\./i;
  api.on('before_agent_start', (event, _ctx) => {
    try {
      const prompt = event?.prompt || '';
      if (prompt.includes('[System Message]')) {
        logger?.info?.('[minion-lifecycle] before_agent_start saw system message payload');
      }
      if (!prompt || !prompt.includes('[System Message]')) return;
      const m = prompt.match(ANNOUNCE_RE);
      if (!m) return;
      const type = (m[1] || '').toLowerCase();
      if (type !== 'subagent task') return;

      const label = normalizeLabel(m[2], '');
      const statusRaw = (m[3] || '').toLowerCase();
      const dedupeKey = `end:${label}`;
      if (!shouldPostDedup(dedupeKey)) return;

      const mapped = normalizeStatusFromResult(statusRaw, statusRaw);
      postToDiscord(webhookUrl, `${mapped.emoji} **${mapped.status}:** \`${label}\` (subagent)`, logger);
      cleanupProgressFile(label, logger);
    } catch (err) {
      logger?.warn?.(`[minion-lifecycle] before_agent_start fallback error: ${err.message}`);
    }
  });

  // Authoritative spawn signal from OpenClaw sub-agent lifecycle
  api.on('subagent_spawned', (event, _ctx) => {
    try {
      logger?.info?.(`[minion-lifecycle] subagent_spawned hook received: runId=${event?.runId || 'n/a'} label=${event?.label || 'n/a'} agentId=${event?.agentId || 'n/a'}`);
      const runId = event?.runId || '';
      const childSessionKey = event?.childSessionKey || '';
      const label = normalizeLabel(event?.label, childSessionKey);
      const mode = event?.mode || 'run';
      const agentId = event?.agentId || 'default';
      const dedupeKey = `spawn:${label}`;
      if (!shouldPostDedup(dedupeKey)) return;

      _lineOffsets.set(label, 0);
      if (runId) {
        _runMeta.set(runId, {
          label,
          childSessionKey,
          startedAt: Date.now(),
        });
      }
      saveState();

      postToDiscord(webhookUrl, `🔄 **Spawned:** \`${label}\` (${agentId}, mode=${mode})`, logger);
    } catch (err) {
      logger?.warn?.(`[minion-lifecycle] subagent_spawned error: ${err.message}`);
    }
  });

  // Authoritative completion signal from OpenClaw sub-agent lifecycle
  api.on('subagent_ended', (event, _ctx) => {
    try {
      logger?.info?.(`[minion-lifecycle] subagent_ended hook received: runId=${event?.runId || 'n/a'} outcome=${event?.outcome || 'n/a'} reason=${event?.reason || 'n/a'}`);
      const runId = event?.runId || '';
      const mapped = runId ? _runMeta.get(runId) : null;

      const label = normalizeLabel(
        mapped?.label || '',
        mapped?.childSessionKey || event?.targetSessionKey || ''
      );

      let { status, emoji, failed } = outcomeToStatus(event?.outcome, event?.reason);
      let reason = truncate(event?.error || event?.reason || '', 180);

      if (status === 'Finished' && !reason) {
        const resultPath = getResultFilePath(runId, mapped?.childSessionKey || event?.targetSessionKey || '');
        const parsed = parseResultFile(resultPath);
        if (parsed) {
          const normalized = normalizeStatusFromResult(parsed.status, parsed.reason || reason);
          status = normalized.status;
          emoji = normalized.emoji;
          failed = normalized.failed;
          if (!reason && parsed.reason) reason = truncate(parsed.reason, 180);
        }
      }

      const dedupeKey = `end:${label}`;
      if (!shouldPostDedup(dedupeKey)) return;

      const mention = failed && errorMention ? `${errorMention} ` : '';
      const reasonSuffix = reason ? ` • ${reason}` : '';

      postToDiscord(webhookUrl, `${mention}${emoji} **${status}:** \`${label}\` (subagent)${reasonSuffix}`, logger);

      cleanupProgressFile(label, logger);
      if (runId) _runMeta.delete(runId);
      saveState();
    } catch (err) {
      logger?.warn?.(`[minion-lifecycle] subagent_ended error: ${err.message}`);
    }
  });
}

module.exports = { name: 'minion-lifecycle', version: VERSION, register };
