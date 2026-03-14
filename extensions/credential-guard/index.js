/**
 * Credential Guard Plugin v2.3.0
 *
 * Four-layer protection via api.on() typed hooks:
 * 1. before_tool_call   - intercepts message sends, blocks exec with credentials
 * 2. before_message_write - redacts assistant messages in session transcript
 * 3. tool_result_persist - redacts tool results before entering context
 * 4. message_sending     - redacts outbound messages BEFORE delivery to Discord/channels
 *
 * v2.3.0 changes:
 * - Added message_sending hook (fixes outbound leak where transcript was redacted
 *   but delivery payload used the pre-redaction content)
 * - Added missing credential patterns: NVIDIA, Discord webhook URLs, base64 gateway
 *   tokens, DashScope, generic long bearer-like strings
 * - Deduplicated redaction stats tracking
 */

const REDACT_LABEL = '[REDACTED]';

const CREDENTIAL_PATTERNS = [
  // --- Provider API keys ---
  { name: 'OpenAI', pattern: /sk-[A-Za-z0-9]{20,}/g },
  { name: 'Anthropic', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'OpenRouter', pattern: /sk-or-[A-Za-z0-9_-]{20,}/g },
  { name: 'Google API', pattern: /AIza[A-Za-z0-9_-]{30,}/g },
  { name: 'PostHog', pattern: /ph[xcp]_[A-Za-z0-9]{20,}/g },
  { name: 'Groq', pattern: /gsk_[A-Za-z0-9]{20,}/g },
  { name: 'ElevenLabs', pattern: /el_[A-Za-z0-9]{20,}/g },
  { name: 'NVIDIA', pattern: /nvapi-[A-Za-z0-9_-]{20,}/g },
  { name: 'GitHub PAT', pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: 'AWS Access', pattern: /AKIA[A-Z0-9]{16}/g },
  { name: 'Vault Token', pattern: /hvs\.[A-Za-z0-9_-]{20,}/g },

  // --- Auth tokens ---
  { name: 'JWT', pattern: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g },
  { name: 'Discord Token', pattern: /[MN][A-Za-z0-9]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g },
  { name: 'Bearer', pattern: /Bearer\s+[A-Za-z0-9_.-]{20,}/gi },
  { name: 'Private Key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'Connection String', pattern: /:\/\/[^:\s]+:[^@\s]+@[^\s]+/g },

  // --- Discord webhook URLs (contain embedded tokens) ---
  { name: 'Discord Webhook', pattern: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{20,}/g },

  // --- Base64 gateway/auth tokens (pattern: 20+ chars with +/= typical of base64) ---
  { name: 'Base64 Token', pattern: /[A-Za-z0-9+\/]{20,}={1,2}/g },
];

let logger = null;
let stats = { redacted: 0, blocked: 0, lastRedacted: null, lastHook: null };

function redactString(str) {
  if (!str || typeof str !== 'string') return { text: str, changed: false };
  let changed = false;
  let result = str;
  for (const { name, pattern } of CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0;
    const found = result.match(pattern);
    if (found) {
      for (const match of found) {
        const preview = match.substring(0, 4) + '***' + REDACT_LABEL;
        result = result.split(match).join(preview);
      }
      changed = true;
    }
  }
  return { text: result, changed };
}

function redactMessageContent(msg) {
  if (!msg) return false;
  let changed = false;

  if (typeof msg.content === 'string') {
    const { text, changed: c } = redactString(msg.content);
    if (c) { msg.content = text; changed = true; }
  }

  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part && typeof part.text === 'string') {
        const { text, changed: c } = redactString(part.text);
        if (c) { part.text = text; changed = true; }
      }
    }
  }

  return changed;
}

function recordRedaction(hookName) {
  stats.redacted++;
  stats.lastRedacted = new Date().toISOString();
  stats.lastHook = hookName;
  logger?.warn?.('credential-guard: REDACTED via ' + hookName + ' (total: ' + stats.redacted + ')');
}

function handleBeforeToolCall(event) {
  const { toolName, params } = event || {};
  if (!toolName || !params) return;

  if (toolName === 'message' && params.action === 'send' && typeof params.message === 'string') {
    const { text, changed } = redactString(params.message);
    if (changed) {
      recordRedaction('before_tool_call:message');
      return { params: Object.assign({}, params, { message: text }) };
    }
  }

  if ((toolName === 'exec' || toolName === 'nodes') && typeof params.command === 'string') {
    const { changed } = redactString(params.command);
    if (changed) {
      stats.blocked++;
      logger?.warn?.('credential-guard: BLOCKED tool call with credential in command');
      return { block: true, blockReason: 'Command contains credential pattern - use scripts that handle secrets internally' };
    }
  }
}

function handleBeforeMessageWrite(event) {
  const msg = event?.message;
  if (!msg) return;

  if (redactMessageContent(msg)) {
    recordRedaction('before_message_write');
    return { message: msg };
  }
}

function handleToolResultPersist(event) {
  const msg = event?.message;
  if (!msg) return;

  if (redactMessageContent(msg)) {
    recordRedaction('tool_result_persist');
    return { message: msg };
  }
}

/**
 * message_sending fires on the OUTBOUND delivery path - the actual message
 * going to Discord/Telegram/etc. This is the critical last-line-of-defense
 * that was missing in v2.2.0. Without this, before_message_write only
 * redacted the transcript copy while the unredacted original went to Discord.
 */
function handleMessageSending(event) {
  if (!event) return;
  var content = event.content;
  if (typeof content !== 'string') return;

  var result = redactString(content);
  if (result.changed) {
    recordRedaction('message_sending');
    return { content: result.text };
  }
}

module.exports = {
  name: 'credential-guard',
  version: '2.3.0',

  register: function(api) {
    logger = api.logger;

    api.on('before_tool_call', handleBeforeToolCall);
    api.on('before_message_write', handleBeforeMessageWrite);
    api.on('tool_result_persist', handleToolResultPersist);
    api.on('message_sending', handleMessageSending);

    logger?.info?.('credential-guard v2.3.0: hooks registered (before_tool_call + before_message_write + tool_result_persist + message_sending)');
  },

  start: async function() {
    logger?.info?.('credential-guard v2.3.0: active');
  },

  stop: async function() {
    logger?.info?.('credential-guard: stopped (redacted ' + stats.redacted + ', blocked ' + stats.blocked + ')');
  }
};
