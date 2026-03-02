/**
 * Promise Keeper Plugin v1.3.0
 * 
 * Two detection modes:
 * 1. TIME PROMISES: "I'll check later" → must schedule a cron
 * 2. FIX PROMISES: "won't happen again", "going forward" → must write a concrete fix to disk
 * 
 * Uses agentCommand (pi-embedded) to inject a system-event nudge.
 */

const fs = require('fs');
const path = require('path');

const PROMISE_PATTERNS = [
  /\b(?:i'll|i will|gonna|going to)\s+(?:check|monitor|watch|look|try|retry|come back|follow up|keep an eye|slide|jump)/i,
  /\b(?:waiting|wait)\s+(?:for|until|till)\b/i,
  /\bas soon as\b/i,
  /\bwhen (?:it|the|that|this)\s+(?:opens?|starts?|becomes?|is ready|finishes?|completes?|stops?)/i,
  /\bonce (?:it|the|that|this|auth)\s+(?:opens?|is|becomes?|starts?|patched|fixed)/i,
  /\bretry(?:ing)?\s+(?:when|after|once|as soon)/i,
  /\bi'll ping\b/i,
  /\bi'll let you know\b/i,
  /\bi'll report back\b/i,
];

// "Fix promises" - declarative commitments that need a concrete disk write, not a cron
const FIX_PROMISE_PATTERNS = [
  /\bwon'?t (?:happen|lose|forget|miss|do (?:that|this)|make that mistake) again\b/i,
  /\bgoing forward\b/i,
  /\bnoted for (?:next|future|later)\b/i,
  /\bwon'?t lose (?:it|this|that) again\b/i,
  /\bi'?ll remember (?:this|that|to)\b/i,
  /\bwon'?t forget\b/i,
  /\bnever again\b/i,
  /\blearned my lesson\b/i,
  /\bfixed for good\b/i,
  /\bthis (?:time|won'?t) be different\b/i,
];

// "Continuation promises" - agent says it will continue but turn ended (likely tool limit)
const CONTINUATION_PATTERNS = [
  /\bcontinuing now\b/i,
  /\bpicking (?:this|it) up\b/i,
  /\bresuming (?:now|work|the task|this)\b/i,
  /\blet me continue\b/i,
  /\bwill continue in (?:the )?next/i,
  /\bcontinuing (?:in )?(?:the )?next/i,
];
const HIGH_TOOL_CALL_THRESHOLD = 25;

// Tools that count as "writing a fix to disk"
const FIX_TOOL_NAMES = new Set(['write', 'edit', 'exec']);

const FALSE_POSITIVE_PATTERNS = [
  /\bwas waiting/i,
  /\bhad been waiting/i,
  /\bfinished waiting/i,
  /\bif you're waiting/i,
  /\bwhile waiting/i,
];

const INTERNAL_SESSION_MARKERS = [':heartbeat', ':subagent:', ':system', ':isolated:'];
const INTERNAL_MESSAGE_MARKERS = [/^\[Inter-session message\]/i, /sourceTool=sessions_send/i, /\[INTERNAL HEARTBEAT WAKE\]/i];
const PUSH_COORDINATION_TOOLS = new Set(['sessions_send', 'sessions_spawn', 'subagents']);

let pluginApi = null;
let agentFnsCache = null;

const recentNudges = new Map();
const NUDGE_COOLDOWN_MS = 5 * 60 * 1000;
const cronCalledThisTurn = new Set();

function resolveDistDir() {
  const candidates = [
    '/usr/local/lib/node_modules/openclaw/dist',
    path.join(process.cwd(), 'node_modules', 'openclaw', 'dist'),
  ];
  for (const dir of candidates) {
    try { if (fs.statSync(dir).isDirectory()) return dir; } catch {}
  }
  return null;
}

async function findFunctions(modulePrefix, functionNames) {
  const distDir = resolveDistDir();
  if (!distDir) return {};
  const files = fs.readdirSync(distDir)
    .filter(f => f.startsWith(modulePrefix) && f.endsWith('.js')
      && !f.includes('helpers') && !f.includes('.pre-'));
  const wanted = new Set(functionNames);
  const found = {};
  for (const file of files) {
    try {
      const mod = await import(path.join(distDir, file));
      const sources = [mod, mod.n].filter(Boolean);
      for (const source of sources) {
        for (const [, value] of Object.entries(source)) {
          if (typeof value === 'function' && wanted.has(value.name)) {
            found[value.name] = value;
            if (Object.keys(found).length === wanted.size) return found;
          }
        }
      }
    } catch {}
  }
  return found;
}

async function getAgentFns() {
  if (agentFnsCache) return agentFnsCache;
  agentFnsCache = await findFunctions('pi-embedded-', ['agentCommand', 'createDefaultDeps']);
  return agentFnsCache;
}

function hasPromisePattern(text) {
  if (!text || typeof text !== 'string') return null;
  for (const fp of FALSE_POSITIVE_PATTERNS) {
    if (fp.test(text)) return null;
  }
  for (const pattern of PROMISE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { type: 'time', match: match[0] };
  }
  return null;
}

function hasFixPromisePattern(text) {
  if (!text || typeof text !== 'string') return null;
  for (const pattern of FIX_PROMISE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function hasFixToolInMessages(messages) {
  if (!Array.isArray(messages)) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user' || msg.role === 'system') break;
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if ((block.type === 'tool_use' || block.type === 'function') && FIX_TOOL_NAMES.has(block.name)) return true;
      }
    }
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const name = tc.function?.name || tc.name;
        if (FIX_TOOL_NAMES.has(name)) return true;
      }
    }
  }
  return false;
}

function countToolCalls(messages) {
  let count = 0;
  if (!Array.isArray(messages)) return count;
  for (const msg of messages) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use' || block.type === 'function') count++;
      }
    }
  }
  return count;
}

function hasContinuationPattern(text) {
  if (!text || typeof text !== 'string') return null;
  for (const pattern of CONTINUATION_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function getLastAssistantText(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user' || msg.role === 'system') break;
    if (msg.role === 'assistant' || msg.role === 'model') {
      if (typeof msg.content === 'string') return msg.content;
      if (Array.isArray(msg.content)) {
        const t = msg.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
        if (t) return t;
      }
      if (Array.isArray(msg.parts)) {
        const t = msg.parts.filter(p => p.text).map(p => p.text).join(' ');
        if (t) return t;
      }
    }
  }
  return '';
}

function hasCronInMessages(messages) {
  if (!Array.isArray(messages)) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user' || msg.role === 'system') break;
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if ((block.type === 'tool_use' || block.type === 'function') && block.name === 'cron') return true;
      }
    }
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if ((tc.function?.name || tc.name) === 'cron') return true;
      }
    }
  }
  return false;
}


function isInternalSession(sessionKey) {
  if (!sessionKey || typeof sessionKey !== 'string') return false;
  const s = sessionKey.toLowerCase();
  return INTERNAL_SESSION_MARKERS.some((m) => s.includes(m));
}

function hasInternalMessageMarkers(text) {
  if (!text || typeof text !== 'string') return false;
  return INTERNAL_MESSAGE_MARKERS.some((re) => re.test(text));
}

function hasPushCoordinationTools(messages) {
  if (!Array.isArray(messages)) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'user' || msg.role === 'system') break;
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        const name = block?.name;
        if ((block.type === 'tool_use' || block.type === 'function') && PUSH_COORDINATION_TOOLS.has(name)) return true;
      }
    }
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        const name = tc.function?.name || tc.name;
        if (PUSH_COORDINATION_TOOLS.has(name)) return true;
      }
    }
  }
  return false;
}

async function sendNudge(sessionKey, nudgeText) {
  const fns = await getAgentFns();
  if (!fns.agentCommand || !fns.createDefaultDeps) {
    pluginApi?.logger?.warn?.('promise-keeper: agentCommand not available - cannot nudge');
    return false;
  }
  const runtime = {
    log: () => {},
    error: (msg) => pluginApi?.logger?.error?.(`promise-keeper [agent]: ${msg}`),
    exit: () => {}
  };
  const deps = fns.createDefaultDeps();
  await fns.agentCommand({
    message: nudgeText,
    sessionKey,
    deliver: true
  }, runtime, deps);
  return true;
}

module.exports = {
  name: 'promise-keeper',
  version: '1.2.1',
  
  register(api, cfg) {
    pluginApi = api;
    api.logger?.info?.('promise-keeper v1.4.0: registered');
    
    // Pre-warm the agent functions cache
    getAgentFns().then(fns => {
      const hasCmd = !!fns.agentCommand;
      const hasDeps = !!fns.createDefaultDeps;
      api.logger?.info?.(`promise-keeper: agentCommand=${hasCmd}, createDefaultDeps=${hasDeps}`);
    }).catch(e => {
      api.logger?.warn?.(`promise-keeper: pre-warm failed: ${e.message}`);
    });
    
    api.on('after_tool_call', (event) => {
      if (event?.toolName === 'cron' || event?.name === 'cron') {
        const sk = event?.sessionKey || 'unknown';
        cronCalledThisTurn.add(sk);
      }
    });
    
    api.on('agent_end', async (event, ctx) => {
      try {
        api.logger?.info?.("promise-keeper: agent_end fired session=" + ctx?.sessionKey + " success=" + event?.success);
        if (!event?.success) return;
        const sessionKey = ctx?.sessionKey;
        if (!sessionKey) return;

        if (isInternalSession(sessionKey)) {
          api.logger?.info?.(`promise-keeper: skipped internal session ${sessionKey}`);
          return;
        }

        const messages = event.messages;
        if (hasPushCoordinationTools(messages)) {
          api.logger?.info?.(`promise-keeper: skipped push-coordination turn ${sessionKey}`);
          return;
        }

        const assistantText = getLastAssistantText(messages);
        if (!assistantText) return;

        if (hasInternalMessageMarkers(assistantText)) {
          api.logger?.info?.(`promise-keeper: skipped internal marker text in ${sessionKey}`);
          return;
        }

        const trimmed = assistantText.trim();
        if (trimmed === 'HEARTBEAT_OK' || trimmed === 'NO_REPLY') return;
        
        // Check for continuation promises (agent claimed it would continue but turn ended)
        const contMatch = hasContinuationPattern(assistantText);
        if (contMatch) {
          const toolCount = countToolCalls(messages);
          if (toolCount >= HIGH_TOOL_CALL_THRESHOLD) {
            const last = recentNudges.get(sessionKey);
            if (!last || (Date.now() - last) >= NUDGE_COOLDOWN_MS) {
              recentNudges.set(sessionKey, Date.now());
              api.logger?.warn?.(
                `promise-keeper: BROKEN CONTINUATION in ${sessionKey}: "${contMatch}" after ${toolCount} tool calls. Turn ended without completing.`
              );
              const nudgeText =
                `[promise-keeper] You said "${contMatch}" but your turn ended (${toolCount} tool calls hit). ` +
                `The user saw your promise but you did NOT continue. Either: ` +
                `(a) actually resume the work now, or ` +
                `(b) tell the user honestly that the tool limit stopped you and you need another turn.`;
              const sent = await sendNudge(sessionKey, nudgeText);
              api.logger?.info?.(`promise-keeper: continuation nudge sent=${sent}`);
            }
            cronCalledThisTurn.delete(sessionKey);
            return;
          }
        }

        // Check for fix promises first (higher priority)
        const fixMatch = hasFixPromisePattern(assistantText);
        if (fixMatch) {
          if (hasFixToolInMessages(messages)) {
            api.logger?.info?.(`promise-keeper: fix promise "${fixMatch}" backed by disk write - OK`);
            cronCalledThisTurn.delete(sessionKey);
            return;
          }
          
          const last = recentNudges.get(sessionKey);
          if (last && (Date.now() - last) < NUDGE_COOLDOWN_MS) {
            cronCalledThisTurn.delete(sessionKey);
            return;
          }
          
          recentNudges.set(sessionKey, Date.now());
          
          api.logger?.warn?.(
            `promise-keeper: EMPTY FIX PROMISE in ${sessionKey}: "${fixMatch}". Nudging.`
          );
          
          const nudgeText =
            `[promise-keeper] NO YOU WONT. TAKE SURGICAL ACTION NOW. ` +
            `You said "${fixMatch}" but wrote NOTHING to disk to back it up. ` +
            `Compaction will erase your intention. Write a concrete fix right now: ` +
            `edit a config, update a workspace file, add a task to current.md, or document a procedure. ` +
            `If you can't fix it, tell the user honestly instead of making empty promises.`;
          
          const sent = await sendNudge(sessionKey, nudgeText);
          api.logger?.info?.(`promise-keeper: fix-promise nudge sent=${sent}`);
          cronCalledThisTurn.delete(sessionKey);
          return;
        }
        
        // Check for time-based promises
        const promiseResult = hasPromisePattern(assistantText);
        if (!promiseResult) {
          cronCalledThisTurn.delete(sessionKey);
          return;
        }
        const promiseMatch = promiseResult.match;
        
        if (cronCalledThisTurn.has(sessionKey) || hasCronInMessages(messages)) {
          api.logger?.info?.(`promise-keeper: promise "${promiseMatch}" but cron was scheduled - OK`);
          cronCalledThisTurn.delete(sessionKey);
          return;
        }
        
        const last = recentNudges.get(sessionKey);
        if (last && (Date.now() - last) < NUDGE_COOLDOWN_MS) {
          cronCalledThisTurn.delete(sessionKey);
          return;
        }
        
        recentNudges.set(sessionKey, Date.now());
        for (const [key, ts] of recentNudges) {
          if (Date.now() - ts > NUDGE_COOLDOWN_MS * 2) recentNudges.delete(key);
        }
        
        api.logger?.warn?.(
          `promise-keeper: BROKEN PROMISE in ${sessionKey}: "${promiseMatch}". Nudging.`
        );
        
        const nudgeText = 
          '[promise-keeper] You told the user you would do something later ' +
          `(detected: "${promiseMatch}") but did NOT schedule any cron or reminder for it. ` +
          'Right now you must either (a) schedule a one-shot cron at a sensible time to follow up on this promise, '
          + 'or (b) clearly tell the user you cannot or will not do it. Do not leave vague future promises without a concrete follow-up.';
        
        const sent = await sendNudge(sessionKey, nudgeText);
        api.logger?.info?.(`promise-keeper: nudge sent=${sent}`);
        
      } catch (err) {
        api.logger?.error?.(`promise-keeper: ${err.message}`);
      } finally {
        if (ctx?.sessionKey) cronCalledThisTurn.delete(ctx.sessionKey);
      }
    });
  },
  
  async start() {
    pluginApi?.logger?.info?.('promise-keeper: active - monitoring promises');
  },
  
  async stop() {
    pluginApi?.logger?.info?.('promise-keeper: stopped');
  }
};
