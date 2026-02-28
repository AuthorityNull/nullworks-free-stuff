/**
 * Credential Guard Plugin v2.2.0
 * 
 * Three-layer protection via api.on() typed hooks:
 * 1. before_tool_call - intercepts message sends, blocks exec with credentials
 * 2. before_message_write - redacts assistant messages before session transcript
 * 3. tool_result_persist - redacts tool results before entering context
 */

const REDACT_LABEL = '[REDACTED]';

const CREDENTIAL_PATTERNS = [
  { name: 'JWT', pattern: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g },
  { name: 'OpenAI', pattern: /sk-[A-Za-z0-9]{20,}/g },
  { name: 'Google API', pattern: /AIza[A-Za-z0-9_-]{30,}/g },
  { name: 'Anthropic', pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'OpenRouter', pattern: /sk-or-[A-Za-z0-9_-]{20,}/g },
  { name: 'GitHub PAT', pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: 'Discord Token', pattern: /[MN][A-Za-z0-9]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g },
  { name: 'PostHog', pattern: /ph[xcp]_[A-Za-z0-9]{20,}/g },
  { name: 'Groq', pattern: /gsk_[A-Za-z0-9]{20,}/g },
  { name: 'ElevenLabs', pattern: /el_[A-Za-z0-9]{20,}/g },
  { name: 'AWS Access', pattern: /AKIA[A-Z0-9]{16}/g },
  { name: 'Vault Token', pattern: /hvs\.[A-Za-z0-9_-]{20,}/g },
  { name: 'Bearer', pattern: /Bearer\s+[A-Za-z0-9_.-]{20,}/gi },
  { name: 'Private Key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'Connection String', pattern: /:\/\/[^:\s]+:[^@\s]+@[^\s]+/g },
];

let logger = null;
let stats = { redacted: 0, lastRedacted: null };

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

function handleBeforeToolCall(event) {
  const { toolName, params } = event || {};
  if (!toolName || !params) return;

  // Intercept message tool sends
  if (toolName === 'message' && params.action === 'send' && typeof params.message === 'string') {
    const { text, changed } = redactString(params.message);
    if (changed) {
      stats.redacted++;
      stats.lastRedacted = new Date().toISOString();
      logger?.warn?.('credential-guard: REDACTED credentials from message tool send (total: ' + stats.redacted + ')');
      return { params: Object.assign({}, params, { message: text }) };
    }
  }

  // Block exec/nodes commands containing credentials
  if ((toolName === 'exec' || toolName === 'nodes') && typeof params.command === 'string') {
    const { text, changed } = redactString(params.command);
    if (changed) {
      stats.redacted++;
      logger?.warn?.('credential-guard: BLOCKED tool call with credential in command');
      return { block: true, blockReason: 'Command contains credential pattern - use scripts that handle secrets internally' };
    }
  }
}

function handleBeforeMessageWrite(event) {
  const msg = event?.message;
  if (!msg) return;

  if (redactMessageContent(msg)) {
    stats.redacted++;
    stats.lastRedacted = new Date().toISOString();
    logger?.warn?.('credential-guard: REDACTED credentials from message (total: ' + stats.redacted + ')');
    return { message: msg };
  }
}

function handleToolResultPersist(event) {
  const msg = event?.message;
  if (!msg) return;

  if (redactMessageContent(msg)) {
    stats.redacted++;
    stats.lastRedacted = new Date().toISOString();
    logger?.warn?.('credential-guard: REDACTED credentials from tool result (total: ' + stats.redacted + ')');
    return { message: msg };
  }
}

module.exports = {
  name: 'credential-guard',
  version: '2.2.0',

  register(api) {
    logger = api.logger;

    // Register typed hooks via api.on()
    api.on('before_tool_call', handleBeforeToolCall);
    api.on('before_message_write', handleBeforeMessageWrite);
    api.on('tool_result_persist', handleToolResultPersist);

    logger?.info?.('credential-guard v2.2.0: hooks registered (before_tool_call + before_message_write + tool_result_persist)');
  },

  async start() {
    logger?.info?.('credential-guard v2.2.0: active');
  },

  async stop() {
    logger?.info?.('credential-guard: stopped (redacted ' + stats.redacted + ' total)');
  }
};
