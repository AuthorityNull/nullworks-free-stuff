/**
 * Minion Lifecycle Plugin v3.0.0
 *
 * Auto-posts sub-agent spawn, completion, and progress events to a Discord webhook.
 * Fire-and-forget - never blocks the agent loop, never throws.
 *
 * Hooks:
 *   after_tool_call    - detects sessions_spawn calls (spawn notification)
 *   before_agent_start - detects [System Message] subagent/cron completion in prompt
 *
 * Progress watcher:
 *   Polls /workspace/tmp/minion-progress/<label>.log for new lines every N seconds.
 *   Posts new lines to the webhook channel.
 *   Cleans up finished progress files after completion is detected.
 */

const fs = require('fs');
const path = require('path');

const VERSION = 'v3.1.0';
const PROGRESS_DIR = '/workspace/tmp/minion-progress';
const DEFAULT_POLL_MS = 15000; // 15 seconds
let _registered = false;
let _pollTimer = null;

// Track how many lines we've already posted per label
const _lineOffsets = new Map();
// Track active labels (from spawn events)
const _activeLabels = new Set();
const OFFSETS_FILE = path.join(PROGRESS_DIR, '.offsets.json');

function loadOffsets() {
  try {
    if (fs.existsSync(OFFSETS_FILE)) {
      const data = JSON.parse(fs.readFileSync(OFFSETS_FILE, 'utf-8'));
      for (const [k, v] of Object.entries(data)) _lineOffsets.set(k, v);
    }
  } catch (_) { /* ignore corrupt file */ }
}

function saveOffsets() {
  try {
    const obj = Object.fromEntries(_lineOffsets);
    fs.writeFileSync(OFFSETS_FILE, JSON.stringify(obj));
  } catch (_) { /* fire-and-forget */ }
}

function postToDiscord(webhookUrl, content, logger) {
  try {
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }).catch(err => {
      logger?.warn?.(`[minion-lifecycle] Webhook POST failed: ${err.message}`);
    });
  } catch (err) {
    logger?.warn?.(`[minion-lifecycle] Webhook error: ${err.message}`);
  }
}

function truncate(str, max) {
  if (!str) return '';
  str = str.replace(/\n/g, ' ').trim();
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function ensureProgressDir() {
  try {
    if (!fs.existsSync(PROGRESS_DIR)) {
      fs.mkdirSync(PROGRESS_DIR, { recursive: true });
    }
  } catch (err) {
    // silently ignore - sub-agents will create it
  }
}

function pollProgressFiles(webhookUrl, agentLabel, logger) {
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

        if (lines.length > offset) {
          const newLines = lines.slice(offset);
          for (const line of newLines) {
            const msg = `📡 **Progress** \`${label}\`: ${truncate(line, 500)}`;
            postToDiscord(webhookUrl, msg, logger);
          }
          _lineOffsets.set(label, lines.length);
          saveOffsets();
        }
      } catch (err) {
        // File might have been deleted between readdir and readFile
      }
    }
  } catch (err) {
    logger?.warn?.(`[minion-lifecycle] Progress poll error: ${err.message}`);
  }
}

function cleanupProgressFile(label, logger) {
  try {
    const filePath = path.join(PROGRESS_DIR, `${label}.log`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger?.info?.(`[minion-lifecycle] Cleaned up progress file: ${filePath}`);
    }
    _lineOffsets.delete(label);
    _activeLabels.delete(label);
    saveOffsets();
  } catch (err) {
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

  if (!webhookUrl) {
    logger?.warn?.(`[minion-lifecycle] ${VERSION}: No webhookUrl configured, plugin inactive`);
    return;
  }

  // Guard against duplicate hook registration
  if (_registered) return;
  _registered = true;

  logger?.info?.(`[minion-lifecycle] ${VERSION}: active (agent=${agentLabel}, progressPoll=${pollMs}ms)`);

  // Ensure progress directory exists and load persisted offsets
  ensureProgressDir();
  loadOffsets();

  // --- Start progress file poller ---
  _pollTimer = setInterval(() => {
    pollProgressFiles(webhookUrl, agentLabel, logger);
  }, pollMs);

  // Don't keep Node alive just for this timer
  if (_pollTimer?.unref) _pollTimer.unref();

  // --- Hook 1: Detect sub-agent spawns ---
  api.on('after_tool_call', (event, ctx) => {
    try {
      if (event?.toolName !== 'sessions_spawn') return;
      if (event?.isError) return;

      const params = event?.params || {};
      const label = params.label || 'unlabeled';
      const model = params.model || params.agentId || 'default';

      _activeLabels.add(label);
      _lineOffsets.set(label, 0); // reset offset for fresh spawn

      let msg = `🔄 **Spawned:** \`${label}\` (${model})`;
      postToDiscord(webhookUrl, msg, logger);
    } catch (err) {
      logger?.warn?.(`[minion-lifecycle] after_tool_call error: ${err.message}`);
    }
  });

  // --- Hook 2: Detect sub-agent/cron completion via before_agent_start ---
  const ANNOUNCE_RE = /\[System Message\].*?A (subagent task|cron job) "([^"]+)" just (.+?)\./;

  api.on('before_agent_start', (event, ctx) => {
    try {
      const prompt = event?.prompt || '';
      if (!prompt.includes('[System Message]')) return;

      const match = prompt.match(ANNOUNCE_RE);
      if (!match) return;

      const [, type, label, statusText] = match;

      let status, emoji;
      if (statusText.includes('timed out')) {
        status = 'Timeout';
        emoji = '⏱️';
      } else if (statusText.includes('failed')) {
        status = 'Failed';
        emoji = '❌';
      } else if (statusText.includes('completed')) {
        status = 'Done';
        emoji = '✅';
      } else {
        status = 'Finished';
        emoji = 'ℹ️';
      }

      const typeLabel = type === 'cron job' ? 'cron' : 'subagent';
      const isFailure = ['Failed', 'Timeout'].includes(status);
      const mention = (isFailure && errorMention) ? `${errorMention} ` : '';
      let msg = `${mention}${emoji} **${status}:** \`${label}\` (${typeLabel})`;
      postToDiscord(webhookUrl, msg, logger);

      // Clean up progress file for completed sub-agent
      cleanupProgressFile(label, logger);
    } catch (err) {
      logger?.warn?.(`[minion-lifecycle] before_agent_start error: ${err.message}`);
    }
  });
}

module.exports = { name: 'minion-lifecycle', version: VERSION, register };
